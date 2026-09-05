import { NotFoundException } from '@nestjs/common';
import { SchoolClassService } from './school-class.service';
import { LECTURE_JOB } from './lecture-queue.constants';
import { getAiRequestContext } from '../../../common/context/ai-request-context';

/**
 * P0-2 durable lecture queue — unit tests (mocked DataSource + Bull queue + AI bridge).
 * No Redis/Postgres needed; queue-restart/recovery is a staging integration test.
 */
describe('SchoolClassService — durable lecture queue', () => {
  let ds: { query: jest.Mock };
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let aiBridge: { transcribeAudio: jest.Mock; generateNotesFromTranscript: jest.Mock };
  let svc: SchoolClassService;

  // per-test row fixtures
  let existingJobRows: any[];
  let recRows: any[];
  let jobStatusRows: any[];

  const calls = () => ds.query.mock.calls;
  const sqlIncludes = (sub: string) => calls().some((c) => String(c[0]).includes(sub));
  const paramMatch = (sub: string, val: any) =>
    calls().some((c) => String(c[0]).includes(sub) && (c[1] || []).includes(val));

  beforeEach(() => {
    existingJobRows = [];
    recRows = [];
    jobStatusRows = [];
    ds = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (/FROM lecture_jobs WHERE recording_id/.test(sql)) return Promise.resolve(existingJobRows);
        if (/JOIN class_recordings r ON/.test(sql)) return Promise.resolve(jobStatusRows);
        if (/FROM class_recordings\s+WHERE id=\$1 AND institute_id/.test(sql)) return Promise.resolve(recRows);
        if (/SELECT transcript FROM class_recordings/.test(sql)) return Promise.resolve([{ transcript: recRows[0]?.transcript || '' }]);
        // Atomic notes claim (merged from origin/dev) uses RETURNING id — succeed the claim.
        if (/notes_status='processing'/.test(sql) && /RETURNING id/.test(sql)) return Promise.resolve([{ id: recRows[0]?.id || 'rec1' }]);
        return Promise.resolve([]); // DDL, UPDATE, INSERT
      }),
    };
    queue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue(null) };
    aiBridge = {
      transcribeAudio: jest.fn().mockResolvedValue({ rawTranscript: 'x'.repeat(60) }),
      generateNotesFromTranscript: jest.fn().mockResolvedValue({ notes: 'y'.repeat(60) }),
    };
    // Constructor order: ds, s3, aiBridge, thumbnail, transcode, stream, r2, lectureQueue
    svc = new SchoolClassService(
      ds as any, {} as any, aiBridge as any, {} as any, {} as any, {} as any, {} as any, queue as any,
    );
    // keep the decorative image pipeline out of these tests
    (svc as any).enrichNotesWithImages = jest.fn().mockResolvedValue({ notes: 'n', images: [] });
  });

  const enqueue = (opts: any = {}) =>
    (svc as any).enqueueLectureJob({ id: 'rec1' }, { id: 'user1', role: 'TEACHER' }, 'inst1', opts);

  it('creates exactly one job and persists trusted identity (not from body)', async () => {
    const res = await enqueue();
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe(LECTURE_JOB);
    expect(data).toMatchObject({ recordingId: 'rec1', instituteId: 'inst1', userId: 'user1', userRole: 'TEACHER' });
    expect(data.requestId).toBeTruthy();
    expect(opts).toMatchObject({ jobId: 'rec1', attempts: 4, removeOnComplete: true, removeOnFail: false });
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 30000 });
    // identity persisted from the authenticated user object
    expect(paramMatch('INSERT INTO lecture_jobs', 'user1')).toBe(true);
    expect(paramMatch('INSERT INTO lecture_jobs', 'TEACHER')).toBe(true);
    expect(res.status).toBe('QUEUED');
  });

  it('does not create a duplicate job while one is in flight', async () => {
    existingJobRows = [{ status: 'TRANSCRIBING' }];
    const res = await enqueue();
    expect(queue.add).not.toHaveBeenCalled();
    expect(res.status).toBe('TRANSCRIBING');
  });

  it('does not reprocess a COMPLETED job (no force)', async () => {
    existingJobRows = [{ status: 'COMPLETED' }];
    const res = await enqueue();
    expect(queue.add).not.toHaveBeenCalled();
    expect(res.status).toBe('COMPLETED');
  });

  it('force re-enqueues after a completed job (frees the Bull jobId)', async () => {
    existingJobRows = [{ status: 'COMPLETED' }];
    const remove = jest.fn().mockResolvedValue(undefined);
    queue.getJob.mockResolvedValue({ getState: () => Promise.resolve('completed'), remove });
    await enqueue({ force: true });
    expect(remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('runLectureJob (fresh) transcribes then generates notes, ends COMPLETED, attributed to the job user', async () => {
    recRows = [{ id: 'rec1', video_url: 'v', transcript: null, transcript_status: null, notes_status: null, topic_id: null, language: 'en' }];
    let ctxSeen: any;
    aiBridge.transcribeAudio.mockImplementation(() => { ctxSeen = getAiRequestContext(); return Promise.resolve({ rawTranscript: 'x'.repeat(60) }); });

    await svc.runLectureJob({ recordingId: 'rec1', instituteId: 'inst1', userId: 'u1', userRole: 'STUDENT', requestId: 'req-1' }, 1);

    expect(aiBridge.transcribeAudio).toHaveBeenCalledTimes(1);
    expect(aiBridge.generateNotesFromTranscript).toHaveBeenCalledTimes(1);
    expect(paramMatch('UPDATE lecture_jobs', 'COMPLETED')).toBe(true);
    // worker re-established attribution from persisted job data (ALS inside the AI call)
    expect(ctxSeen).toMatchObject({ userId: 'u1', userRole: 'STUDENT', requestId: 'req-1' });
  });

  it('retries NOTES ONLY when transcription already succeeded', async () => {
    recRows = [{ id: 'rec1', video_url: 'v', transcript: 't'.repeat(60), transcript_status: 'done', notes_status: 'failed', topic_id: null, language: 'en' }];
    await svc.runLectureJob({ recordingId: 'rec1', instituteId: 'inst1', userId: 'u1', userRole: 'TEACHER', requestId: 'r', force: true, only: 'notes' }, 2);
    expect(aiBridge.transcribeAudio).not.toHaveBeenCalled();       // NOT re-transcribed
    expect(aiBridge.generateNotesFromTranscript).toHaveBeenCalledTimes(1);
  });

  it('a retryable provider 429 rethrows for Bull and does NOT mark FAILED', async () => {
    recRows = [{ id: 'rec1', video_url: 'v', transcript: null, transcript_status: null, notes_status: null, topic_id: null, language: 'en' }];
    aiBridge.transcribeAudio.mockRejectedValue({ response: { status: 429 }, message: 'rate limited' });
    await expect(
      svc.runLectureJob({ recordingId: 'rec1', instituteId: 'inst1', userId: 'u1', userRole: 'T', requestId: 'r' }, 1),
    ).rejects.toBeTruthy();
    expect(sqlIncludes("status='FAILED'")).toBe(false);
  });

  it('a permanent provider 400 becomes FAILED without rethrowing', async () => {
    recRows = [{ id: 'rec1', video_url: 'v', transcript: null, transcript_status: null, notes_status: null, topic_id: null, language: 'en' }];
    aiBridge.transcribeAudio.mockRejectedValue({ response: { status: 400 }, message: 'bad request' });
    await expect(
      svc.runLectureJob({ recordingId: 'rec1', instituteId: 'inst1', userId: 'u1', userRole: 'T', requestId: 'r' }, 1),
    ).resolves.toBeUndefined();
    expect(sqlIncludes("status='FAILED'")).toBe(true);
  });

  it('getJobStatus rejects cross-tenant access (ownership by institute)', async () => {
    jobStatusRows = []; // institute filter yields nothing for another tenant
    await expect(
      svc.getJobStatus({ instituteId: 'other-inst', role: 'TEACHER' }, 'rec1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('missing recording marks the job FAILED (non-retryable) and does not throw', async () => {
    recRows = []; // recording deleted
    await expect(
      svc.runLectureJob({ recordingId: 'gone', instituteId: 'inst1', userId: 'u', userRole: 'T', requestId: 'r' }, 1),
    ).resolves.toBeUndefined();
    expect(sqlIncludes("status='FAILED'")).toBe(true);
  });
});
