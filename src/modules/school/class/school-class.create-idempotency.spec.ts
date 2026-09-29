import { BadRequestException, ConflictException } from '@nestjs/common';
import { SchoolClassService } from './school-class.service';

/**
 * P0-3 recording-creation idempotency — unit tests (mocked DataSource, mocked
 * enqueueLectureJob). No Postgres/Redis.
 *
 * The DataSource mock keeps an in-memory table keyed by `institute|video_key`,
 * which models the PARTIAL unique index faithfully: only non-NULL keys are
 * indexed, so NULL-key rows (live_stream / youtube) never collide, and the key
 * is scoped per institute.
 */
describe('SchoolClassService — P0-3 create() idempotency', () => {
  let ds: { query: jest.Mock };
  let svc: SchoolClassService;
  let enqueue: jest.Mock;

  /** `${institute}|${video_key}` -> row. Stands in for the partial unique index. */
  let keyed: Map<string, any>;
  let rowsById: any[];
  let seq: number;
  /** lecture_jobs rows returned for the replay-path existence probe. */
  let lectureJobRows: any[];
  /** Force the Nth INSERT to report a conflict without a winner (the R2 case). */
  let phantomConflictOnce: boolean;
  /** false => simulate the unique index being absent. */
  let indexPresent: boolean;

  const K = (inst: any, key: any) => `${inst}|${key}`;

  beforeEach(() => {
    keyed = new Map();
    rowsById = [];
    seq = 0;
    lectureJobRows = [{ n: 1 }]; // by default the first request queued its job
    phantomConflictOnce = false;
    indexPresent = true;

    ds = {
      query: jest.fn().mockImplementation((sql: string, params: any[] = []) => {
        // --- P0-3 index bootstrap ---
        if (/HAVING COUNT\(\*\) > 1/.test(sql)) return Promise.resolve([]); // no duplicates
        if (/FROM pg_indexes/.test(sql)) {
          return Promise.resolve(indexPresent ? [{ ok: 1 }] : []);
        }
        // --- create() scope resolution ---
        if (/FROM sections sec/.test(sql)) return Promise.resolve([{ id: 'sub1', name: 'Science' }]);
        if (/teacher_academic_assignments/.test(sql)) return Promise.resolve([{ ok: 1 }]);
        // --- replay path: does this recording already have a job? ---
        if (/FROM lecture_jobs WHERE recording_id/.test(sql)) return Promise.resolve(lectureJobRows);
        // --- the idempotency lookup ---
        if (/SELECT \* FROM class_recordings WHERE institute_id/.test(sql)) {
          const hit = keyed.get(K(params[0], params[1]));
          return Promise.resolve(hit ? [hit] : []);
        }
        // --- the insert itself ---
        if (/INSERT INTO class_recordings/.test(sql)) {
          const [instituteId, , , , , , teacherUserId] = params;
          const videoKey = params[10];
          const source = params[12];
          const guarded = /ON CONFLICT/.test(sql);
          if (guarded && videoKey != null) {
            if (phantomConflictOnce) {
              // Conflicting txn aborted: DO NOTHING suppressed us, no winner exists.
              phantomConflictOnce = false;
              return Promise.resolve([]);
            }
            if (keyed.has(K(instituteId, videoKey))) return Promise.resolve([]);
          }
          const row = {
            id: `rec${++seq}`,
            institute_id: instituteId,
            teacher_user_id: teacherUserId,
            video_key: videoKey,
            source,
            title: params[7],
          };
          rowsById.push(row);
          // Only non-NULL keys are indexed — this is what makes the index partial.
          if (videoKey != null) keyed.set(K(instituteId, videoKey), row);
          return Promise.resolve([row]);
        }
        return Promise.resolve([]); // DDL, updates, everything else
      }),
    };

    svc = new SchoolClassService(
      ds as any,
      { setCacheControl: jest.fn().mockResolvedValue(undefined), keyFromUrl: jest.fn(() => null) } as any,
      {} as any,
      {} as any, // textbooks (4th slot, added upstream) — unreachable here: enqueueLectureJob is mocked
      {} as any,
      {} as any,
      { isConfigured: () => false } as any,
      {} as any,
      { add: jest.fn(), getJob: jest.fn() } as any,
    );

    // Never touch the real pipeline or the media side effects.
    enqueue = jest.fn().mockResolvedValue({ jobId: 'rec1', status: 'QUEUED' });
    (svc as any).enqueueLectureJob = enqueue;
    (svc as any).processThumbnail = jest.fn().mockResolvedValue(undefined);
    (svc as any).processStream = jest.fn().mockResolvedValue(undefined);
    (svc as any).processTranscode = jest.fn().mockResolvedValue(undefined);
    (svc as any).processFaststart = jest.fn().mockResolvedValue(undefined);
  });

  const TEACHER = { id: 'user1', role: 'TEACHER', instituteId: 'inst1' };

  const body = (over: any = {}) => ({
    title: 'Lecture 1',
    videoUrl: 'https://cdn/v.mp4',
    videoKey: 'tenants/inst1/class-recordings/1-uuid-v.mp4',
    classId: 'c1',
    sectionId: 's1',
    subjectId: 'sub1',
    source: 'upload',
    ...over,
  });

  it('a new upload key creates exactly one recording and queues exactly one job', async () => {
    const res: any = await svc.create(TEACHER, body());
    expect(res.success).toBe(true);
    expect(res.data.id).toBe('rec1');
    expect(rowsById).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('uses ON CONFLICT only when the backing index exists', async () => {
    await svc.create(TEACHER, body());
    const insert = ds.query.mock.calls.find((c) => /INSERT INTO class_recordings/.test(String(c[0])));
    expect(String(insert![0])).toContain('ON CONFLICT (institute_id, video_key)');
    expect(String(insert![0])).toContain('WHERE video_key IS NOT NULL');
  });

  it('falls back to a plain INSERT when the index is missing (endpoint stays up)', async () => {
    indexPresent = false;
    const res: any = await svc.create(TEACHER, body());
    expect(res.success).toBe(true);
    const insert = ds.query.mock.calls.find((c) => /INSERT INTO class_recordings/.test(String(c[0])));
    expect(String(insert![0])).not.toContain('ON CONFLICT');
  });

  it('the same (institute_id, video_key) twice returns the existing recording and queues NO second job', async () => {
    const first: any = await svc.create(TEACHER, body());
    enqueue.mockClear();

    const second: any = await svc.create(TEACHER, body({ title: 'Renamed retry' }));

    expect(second.data.id).toBe(first.data.id);
    expect(rowsById).toHaveLength(1);          // no second recording
    expect(enqueue).not.toHaveBeenCalled();    // no second pipeline
    expect(second.success).toBe(true);         // response contract preserved
  });

  it('concurrent identical creates produce exactly one recording and one job', async () => {
    const [a, b]: any[] = await Promise.all([
      svc.create(TEACHER, body()),
      svc.create(TEACHER, body()),
    ]);
    expect(rowsById).toHaveLength(1);
    expect(a.data.id).toBe(b.data.id);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('R2 — a conflict with no winner (aborted txn) retries the insert instead of failing', async () => {
    phantomConflictOnce = true;
    const res: any = await svc.create(TEACHER, body());
    expect(res.success).toBe(true);
    expect(rowsById).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const inserts = ds.query.mock.calls.filter((c) => /INSERT INTO class_recordings/.test(String(c[0])));
    expect(inserts).toHaveLength(2); // suppressed once, then retried
  });

  it('the same video key under a DIFFERENT institute stays independent', async () => {
    await svc.create(TEACHER, body());
    const other = { id: 'user9', role: 'TEACHER', instituteId: 'inst2' };
    const res: any = await svc.create(other, body());
    expect(rowsById).toHaveLength(2);
    expect(res.data.institute_id).toBe('inst2');
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('different video keys in the SAME institute stay independent', async () => {
    await svc.create(TEACHER, body());
    const res: any = await svc.create(TEACHER, body({ videoKey: 'tenants/inst1/class-recordings/2-uuid-v.mp4' }));
    expect(rowsById).toHaveLength(2);
    expect(res.data.id).toBe('rec2');
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('an upload without a videoKey is rejected (cannot opt out of dedupe)', async () => {
    await expect(svc.create(TEACHER, body({ videoKey: undefined }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(TEACHER, body({ videoKey: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(rowsById).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('youtube/NULL-key recordings remain valid and are never deduped against each other', async () => {
    const a: any = await svc.create(TEACHER, body({ source: 'youtube', videoKey: undefined, videoUrl: 'https://youtu.be/abc' }));
    const b: any = await svc.create(TEACHER, body({ source: 'youtube', videoKey: undefined, videoUrl: 'https://youtu.be/abc' }));
    expect(a.data.id).not.toBe(b.data.id);
    expect(rowsById).toHaveLength(2);
    expect(keyed.size).toBe(0);        // NULL keys are not indexed
    expect(enqueue).not.toHaveBeenCalled(); // youtube is never transcribed
  });

  it('the partial index DDL only covers non-NULL keys, so live_stream rows never collide', async () => {
    await svc.create(TEACHER, body());
    const ddl = ds.query.mock.calls.map((c) => String(c[0]))
      .find((s) => s.includes('uq_class_recordings_institute_video_key') && s.includes('CREATE UNIQUE INDEX'));
    expect(ddl).toBeDefined();
    expect(ddl).toContain('IF NOT EXISTS');
    expect(ddl).toContain('WHERE video_key IS NOT NULL');
  });

  it('refuses to create the index while duplicates exist, and never mutates rows', async () => {
    ds.query.mockImplementation((sql: string) => {
      if (/HAVING COUNT\(\*\) > 1/.test(sql)) {
        return Promise.resolve([{ institute_id: 'inst1', video_key: 'dupe', n: 2 }]);
      }
      if (/CREATE UNIQUE INDEX/.test(sql)) throw new Error('index must not be created while duplicates exist');
      return Promise.resolve([]);
    });
    await (svc as any).ensureRecordingUploadKeyIndex();
    expect((svc as any).recordingKeyIndexReady).toBe(false);
    const mutations = ds.query.mock.calls.filter((c) => /DELETE FROM class_recordings|UPDATE class_recordings/.test(String(c[0])));
    expect(mutations).toHaveLength(0);
  });

  it("another teacher's key yields 409 and never discloses the recording", async () => {
    await svc.create(TEACHER, body());
    enqueue.mockClear();
    const intruder = { id: 'user2', role: 'TEACHER', instituteId: 'inst1' };

    await expect(svc.create(intruder, body())).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.create(intruder, body())).rejects.toThrow(/already been uploaded/);

    expect(rowsById).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('an institute admin may be handed the existing recording', async () => {
    const first: any = await svc.create(TEACHER, body());
    const admin = { id: 'admin1', role: 'INSTITUTE_ADMIN', instituteId: 'inst1' };
    const res: any = await svc.create(admin, body());
    expect(res.data.id).toBe(first.data.id);
    expect(rowsById).toHaveLength(1);
  });

  // ---- N1: a transient CREATE failure must not disable dedupe for the whole process ----
  describe('N1 — readiness recovery after a failed index bootstrap', () => {
    /** CREATE always throws; pg_indexes reports whatever `indexLive` says. */
    const bootstrapWithFailingCreate = (indexLive: boolean, recheckThrows = false) => {
      ds.query.mockImplementation((sql: string) => {
        if (/HAVING COUNT\(\*\) > 1/.test(sql)) return Promise.resolve([]);
        if (/CREATE UNIQUE INDEX/.test(sql)) return Promise.reject(new Error('transient: connection reset'));
        if (/FROM pg_indexes/.test(sql)) {
          if (recheckThrows) return Promise.reject(new Error('still down'));
          return Promise.resolve(indexLive ? [{ ok: 1 }] : []);
        }
        return Promise.resolve([]);
      });
    };

    it('index actually present → readiness becomes true despite the error', async () => {
      bootstrapWithFailingCreate(true);
      await (svc as any).ensureRecordingUploadKeyIndex();
      expect((svc as any).recordingKeyIndexReady).toBe(true);
    });

    it('index genuinely absent → readiness stays false (safe fallback)', async () => {
      bootstrapWithFailingCreate(false);
      await (svc as any).ensureRecordingUploadKeyIndex();
      expect((svc as any).recordingKeyIndexReady).toBe(false);
    });

    it('re-check itself failing → readiness stays false and nothing throws', async () => {
      bootstrapWithFailingCreate(false, true);
      await expect((svc as any).ensureRecordingUploadKeyIndex()).resolves.toBeUndefined();
      expect((svc as any).recordingKeyIndexReady).toBe(false);
    });

    it('recovered readiness actually re-enables ON CONFLICT in create()', async () => {
      bootstrapWithFailingCreate(true);
      await (svc as any).ensureRecordingUploadKeyIndex();
      expect((svc as any).recordingKeyIndexReady).toBe(true);

      // Bootstrap already ran; let create() proceed and capture the insert it builds.
      (svc as any).tableReady = true;
      let insertSql = '';
      ds.query.mockImplementation((sql: string) => {
        if (/FROM sections sec/.test(sql)) return Promise.resolve([{ id: 'sub1' }]);
        if (/teacher_academic_assignments/.test(sql)) return Promise.resolve([{ ok: 1 }]);
        if (/INSERT INTO class_recordings/.test(sql)) {
          insertSql = sql;
          return Promise.resolve([{ id: 'rec1', source: 'upload', teacher_user_id: 'user1' }]);
        }
        return Promise.resolve([]);
      });
      await svc.create(TEACHER, body());

      // Without the N1 fix readiness would still be false here and this would be
      // a plain INSERT — silently unprotected for the life of the process.
      expect(insertSql).toContain('ON CONFLICT (institute_id, video_key)');
      expect(insertSql).toContain('WHERE video_key IS NOT NULL');
    });

    it('the happy path is unchanged — readiness true, no error branch needed', async () => {
      await (svc as any).ensureRecordingUploadKeyIndex(); // default mock: CREATE succeeds
      expect((svc as any).recordingKeyIndexReady).toBe(true);
    });
  });

  it('a replay recovers the MISSING job when the first request died before queueing', async () => {
    await svc.create(TEACHER, body());
    enqueue.mockClear();
    lectureJobRows = []; // the original never queued anything

    const res: any = await svc.create(TEACHER, body());

    expect(rowsById).toHaveLength(1);                 // still no duplicate recording
    expect(enqueue).toHaveBeenCalledTimes(1);         // the missing job, not a second one
    expect(enqueue.mock.calls[0][0].id).toBe(res.data.id);
  });
});
