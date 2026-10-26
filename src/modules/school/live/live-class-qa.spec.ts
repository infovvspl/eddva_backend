/**
 * Fixes from the Live Class QA report (16 Oct 2026): B-01 time zone, B-02
 * stream key exposure, B-03 past dates, B-04 ending a class that never
 * started, B-05 chat limit feedback, B-06/B-22 chat mute, B-08 editing,
 * B-12 credentials after a class ends, B-21 one "missed" rule.
 */
import { BadRequestException } from '@nestjs/common';
import { canSeeStreamKey, forViewer, isMissed, parseScheduledFor } from './live-class-rules';
import { SchoolLiveService } from './school-live.service';
import { CHAT_LIMIT, SchoolLiveGateway } from './school-live.gateway';

const NOW = new Date('2026-10-16T06:30:00Z'); // 12:00 PM IST

describe('parseScheduledFor (B-01, B-03)', () => {
  it('reads a form value with no zone as India time', () => {
    // 10:00 PM IST is 16:30 UTC, not 22:00 UTC.
    expect(parseScheduledFor('2026-10-16T22:00', NOW)!.toISOString()).toBe('2026-10-16T16:30:00.000Z');
  });

  it('keeps a value that carries its zone', () => {
    expect(parseScheduledFor('2026-10-16T16:30:00.000Z', NOW)!.toISOString()).toBe('2026-10-16T16:30:00.000Z');
    expect(parseScheduledFor('2026-10-16T22:00:00+05:30', NOW)!.toISOString()).toBe('2026-10-16T16:30:00.000Z');
  });

  it('refuses a time in the past, with a little grace', () => {
    expect(() => parseScheduledFor('2026-10-10T10:00', NOW)).toThrow(BadRequestException);
    expect(parseScheduledFor('2026-10-16T11:57', NOW)).not.toBeNull(); // 3 minutes ago
  });

  it('no time means none, and nonsense is refused', () => {
    expect(parseScheduledFor(undefined, NOW)).toBeNull();
    expect(parseScheduledFor('', NOW)).toBeNull();
    expect(() => parseScheduledFor('not a date', NOW)).toThrow(BadRequestException);
  });
});

describe('isMissed (B-21)', () => {
  it('a scheduled class more than an hour past its start is missed', () => {
    expect(isMissed({ status: 'SCHEDULED', scheduledFor: '2026-10-16T05:00:00Z' }, NOW)).toBe(true);
    expect(isMissed({ status: 'SCHEDULED', scheduledFor: '2026-10-16T06:00:00Z' }, NOW)).toBe(false);
    expect(isMissed({ status: 'SCHEDULED', scheduledFor: '2026-10-17T06:00:00Z' }, NOW)).toBe(false);
  });

  it('only scheduled classes can be missed', () => {
    expect(isMissed({ status: 'LIVE', scheduledFor: '2026-10-10T05:00:00Z' }, NOW)).toBe(false);
    expect(isMissed({ status: 'ENDED', scheduledFor: '2026-10-10T05:00:00Z' }, NOW)).toBe(false);
  });
});

describe('forViewer (B-02, B-12)', () => {
  const row = { id: 'l1', status: 'SCHEDULED', scheduledFor: '2026-10-17T06:00:00Z', streamKey: 'k'.repeat(32),
    playbackUrl: 'http://13.127.31.213:8080/hls/kkk/index.m3u8', rtmpUrl: 'rtmp://x/live', playbackId: 'p'.repeat(32) };

  it('a student never gets the stream key or a URL built from it', () => {
    const out: any = forViewer(row, 'STUDENT', NOW);
    expect(out.streamKey).toBeUndefined();
    expect(out.playbackUrl).toBeUndefined();
    expect(out.rtmpUrl).toBeUndefined();
    expect(out.playbackId).toBe('p'.repeat(32));
    expect(JSON.stringify(out)).not.toContain('k'.repeat(32));
  });

  it('the teacher gets the credentials while the class is open', () => {
    const out: any = forViewer(row, 'TEACHER', NOW);
    expect(out.streamKey).toBe('k'.repeat(32));
    expect(out.rtmpUrl).toBe('rtmp://x/live');
  });

  it('nobody gets them once the class is closed', () => {
    for (const status of ['ENDED', 'PROCESSED', 'CANCELLED']) {
      expect((forViewer({ ...row, status }, 'TEACHER', NOW) as any).streamKey).toBeUndefined();
    }
  });

  it('multi-role accounts with a teaching role may hold keys', () => {
    expect(canSeeStreamKey('TEACHER,INSTITUTE_ADMIN')).toBe(true);
    expect(canSeeStreamKey('STUDENT')).toBe(false);
  });
});

function makeService(lecture: any) {
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM school_live_lectures WHERE id = $1')) return lecture ? [{ ...lecture }] : [];
    if (/UPDATE school_live_lectures\s+SET status = \$2/.test(sql)) {
      lecture.status = params[1];
      return [[{ streamKey: lecture.streamKey, instId: 'inst', streamStoppedAt: lecture.streamStoppedAt ?? null }], 1];
    }
    if (sql.includes('UPDATE school_live_lectures') && sql.includes('scheduled_for = COALESCE')) {
      if (params[1]) lecture.title = params[1];
      if (params[3]) lecture.scheduledFor = params[3];
      return [];
    }
    if (sql.includes('SELECT id FROM teachers')) return [{ id: 't1' }];
    if (sql.includes('teacher_academic_assignments')) return [{ 1: 1 }];
    if (sql.includes('FROM students')) return [];
    return [];
  });
  const redis = { publish: jest.fn(async () => undefined) };
  const config = { get: jest.fn((k: string) => (k === 'streaming.serverIp' ? '1.2.3.4' : '')) };
  const notifications = { create: jest.fn(async () => undefined) };
  const svc = new SchoolLiveService(
    { query } as any, { query: jest.fn() } as any, { add: jest.fn() } as any, redis as any,
    config as any, {} as any, {} as any, notifications as any, {} as any,
  );
  return { svc, query, redis };
}

const TEACHER = { id: 'u-t', role: 'TEACHER', instituteId: 'inst' };
const STUDENT = { id: 'u-s', role: 'STUDENT', instituteId: 'inst', studentProfile: { sectionId: 'sec' } };
const base = () => ({ id: 'l1', status: 'SCHEDULED', instituteId: 'inst', teacherId: 't1', sectionId: 'sec', classId: 'c1',
  streamKey: 'a'.repeat(32), playbackId: 'b'.repeat(32), playbackUrl: 'http://cdn/aaa', scheduledFor: '2099-01-01T00:00:00Z',
  title: 'Physics', chatEnabled: true });

describe('SchoolLiveService', () => {
  it('B-02: a student\'s stream URL carries the playback ID, never the key', async () => {
    const { svc } = makeService({ ...base(), status: 'LIVE' });
    const out: any = await svc.getStreamUrl('l1', STUDENT as any);
    expect(out.streamKey).toBeUndefined();
    expect(out.url).toBe(`/school/live/hls/${'b'.repeat(32)}/index.m3u8`);
    expect(JSON.stringify(out)).not.toContain('a'.repeat(32));
  });

  it('B-02: the teacher still gets the key for OBS', async () => {
    const { svc } = makeService({ ...base(), status: 'LIVE' });
    expect(((await svc.getStreamUrl('l1', TEACHER as any)) as any).streamKey).toBe('a'.repeat(32));
  });

  it('B-04: ending a class that never started cancels it', async () => {
    const lecture = base();
    const { svc } = makeService(lecture);
    expect(await svc.endLecture(TEACHER as any, 'l1')).toEqual({ success: true, status: 'CANCELLED' });
  });

  it('B-04: ending a live class ends it', async () => {
    const lecture = { ...base(), status: 'LIVE' };
    const { svc } = makeService(lecture);
    expect(await svc.endLecture(TEACHER as any, 'l1')).toEqual({ success: true, status: 'ENDED' });
  });

  it('B-08: a scheduled class can be renamed and moved; its students are told', async () => {
    const lecture = base();
    const { svc } = makeService(lecture);
    const out: any = await svc.updateLecture(TEACHER as any, 'l1', { title: 'Physics (moved)', scheduledFor: '2099-02-01T10:00' });
    expect(out.title).toBe('Physics (moved)');
    expect(out.scheduledFor).toBe('2099-02-01T04:30:00.000Z');
  });

  it('B-08: a class that has started cannot be changed, and a past time is refused', async () => {
    const { svc } = makeService({ ...base(), status: 'LIVE' });
    await expect(svc.updateLecture(TEACHER as any, 'l1', { title: 'x' })).rejects.toThrow(BadRequestException);
    const { svc: svc2 } = makeService(base());
    await expect(svc2.updateLecture(TEACHER as any, 'l1', { scheduledFor: '2020-01-01T10:00' })).rejects.toThrow(BadRequestException);
  });
});

describe('SchoolLiveGateway chat (B-05, B-22)', () => {
  function makeGateway(opts: { allow?: boolean } = {}) {
    const emitted: any[] = [];
    const svc = {
      saveChat: jest.fn(async (_l: string, userId: string, userName: string, text: string) => ({ userId, userName, text })),
      setChatEnabled: jest.fn(async () => undefined),
    };
    const redis = { allowAction: jest.fn(async () => opts.allow !== false), subscribe: jest.fn() };
    const gw = new SchoolLiveGateway(svc as any, redis as any);
    gw.server = { to: () => ({ emit: (event: string, data: any) => emitted.push(['room', event, data]) }) } as any;
    const client = (role: string) => ({
      data: { userId: `u-${role}`, userName: role, lectureId: 'l1', role },
      emit: (event: string, data: any) => emitted.push(['client', event, data]),
    });
    return { gw, svc, redis, emitted, client };
  }

  it('B-22: while chat is off, a student\'s message is refused and they are told', async () => {
    const { gw, svc, emitted, client } = makeGateway();
    await gw.handleUpdateSettings(client('TEACHER') as any, { chatEnabled: false });
    expect(svc.setChatEnabled).toHaveBeenCalledWith('l1', false);
    expect(emitted).toContainEqual(['room', 'chat-settings', { chatEnabled: false }]);
    await gw.handleChat(client('STUDENT') as any, { text: 'after mute test' });
    expect(svc.saveChat).not.toHaveBeenCalled();
    expect(emitted).toContainEqual(['client', 'chat-muted', { chatEnabled: false, text: 'after mute test' }]);
  });

  it('B-22: the teacher can still post while students are muted', async () => {
    const { gw, svc, client } = makeGateway();
    await gw.handleUpdateSettings(client('TEACHER') as any, { chatEnabled: false });
    await gw.handleChat(client('TEACHER') as any, { text: 'class notes' });
    expect(svc.saveChat).toHaveBeenCalled();
  });

  it('B-05: over the limit, the student is told with their text; teachers are not limited', async () => {
    const { gw, svc, redis, emitted, client } = makeGateway({ allow: false });
    await gw.handleChat(client('STUDENT') as any, { text: 'msg 7' });
    expect(svc.saveChat).not.toHaveBeenCalled();
    expect(emitted).toContainEqual(['client', 'chat-rate-limited', { retryInSeconds: 10, text: 'msg 7' }]);
    await gw.handleChat(client('TEACHER') as any, { text: 'teacher msg' });
    expect(svc.saveChat).toHaveBeenCalledTimes(1);
    expect(redis.allowAction).toHaveBeenCalledWith('chatrl:l1:u-STUDENT', CHAT_LIMIT, 10);
  });

  it('only a teacher can change settings', async () => {
    const { gw, svc, client } = makeGateway();
    await gw.handleUpdateSettings(client('STUDENT') as any, { chatEnabled: false });
    expect(svc.setChatEnabled).not.toHaveBeenCalled();
  });
});
