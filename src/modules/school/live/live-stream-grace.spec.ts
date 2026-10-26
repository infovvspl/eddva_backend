/**
 * Live Class QA follow-up (16 Oct 2026): B-28 reconnect grace after OBS
 * stops, and B-32 a student connected twice.
 */
import * as jwt from 'jsonwebtoken';
import { DEFAULT_RECONNECT_GRACE_SECONDS, reconnectGraceSeconds } from './live-class-rules';
import { SchoolLiveService } from './school-live.service';
import { SchoolLiveGateway } from './school-live.gateway';
import { SCHOOL_LIVE_CHANNELS } from './school-live.redis';

const CLOSED = ['ENDED', 'PROCESSED', 'PROCESSING_FAILED', 'CANCELLED'];
const LECTURE_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(32);
const TEACHER = { id: 'u-t', role: 'TEACHER', instituteId: 'inst' };

/** The service over an in-memory lecture row whose SQL clock the test moves. */
function makeWorld() {
  const clock = { now: Date.parse('2026-10-16T10:00:00Z') };
  const lec: any = {
    id: LECTURE_ID, status: 'SCHEDULED', streamKey: KEY, instituteId: 'inst', classId: 'c1',
    startedAt: null, endedAt: null, streamStoppedAt: null,
  };
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const now = clock.now;
    if (q.includes('WHERE stream_key = $1 AND status NOT IN')) {
      return CLOSED.includes(lec.status) ? [] : [{ id: lec.id, title: 'Physics', status: lec.status, class_id: lec.classId }];
    }
    if (q.startsWith("UPDATE school_live_lectures SET status = 'LIVE'")) {
      lec.startedAt = lec.status === 'LIVE' ? (lec.startedAt ?? now) : now;
      Object.assign(lec, { status: 'LIVE', endedAt: null, streamStoppedAt: null });
      return [[], 1];
    }
    if (q.includes('status FROM school_live_lectures WHERE stream_key = $1')) {
      return [{ id: lec.id, instId: 'inst', status: lec.status }];
    }
    if (q.includes("SET stream_stopped_at = now() WHERE id = $1 AND status = 'LIVE'")) {
      if (lec.status === 'LIVE') lec.streamStoppedAt = now;
      return [[], 1];
    }
    if (q.includes('SET stream_stopped_at = COALESCE')) {
      lec.streamStoppedAt ??= now;
      return [[], 1];
    }
    if (q.includes("SET status = 'ENDED', ended_at = stream_stopped_at")) {
      const [grace, id] = params;
      if (lec.status === 'LIVE' && lec.streamStoppedAt !== null && lec.streamStoppedAt <= now - grace * 1000 && (!id || id === lec.id)) {
        Object.assign(lec, { status: 'ENDED', endedAt: lec.streamStoppedAt });
        return [[{ id: lec.id, streamKey: lec.streamKey, instId: 'inst' }], 1];
      }
      return [[], 0];
    }
    if (q.includes('SET status = $2')) {
      if (CLOSED.includes(lec.status)) return [[], 0];
      lec.status = params[1];
      lec.endedAt ??= lec.streamStoppedAt ?? now;
      return [[{ streamKey: lec.streamKey, instId: 'inst', streamStoppedAt: lec.streamStoppedAt }], 1];
    }
    if (q.includes('FROM school_live_lectures WHERE id = $1')) return [{ ...lec, teacherId: 't1', chatEnabled: true }];
    if (q.includes('SELECT id FROM teachers')) return [{ id: 't1' }];
    if (q.includes('teacher_academic_assignments')) return [{ 1: 1 }];
    if (q.includes('FROM students s')) return [{ user_id: 'stu-1' }];
    return [];
  });
  const redis = { publish: jest.fn(async () => 1) };
  const queue = { add: jest.fn(async (..._args: any[]) => ({})) };
  const notifications = { create: jest.fn(async () => undefined) };
  const config = { get: jest.fn(() => '') };
  const svc = new SchoolLiveService(
    { query } as any, { query: jest.fn(async () => []) } as any, queue as any, redis as any,
    config as any, {} as any, {} as any, notifications as any, { isReady: false } as any,
  );
  const published = (channel: string) => redis.publish.mock.calls.filter((c: any[]) => c[0] === channel).length;
  const advance = (seconds: number) => { clock.now += seconds * 1000; };
  return { svc, lec, queue, notifications, published, advance };
}

const GRACE = DEFAULT_RECONNECT_GRACE_SECONDS;

describe('reconnectGraceSeconds (B-28)', () => {
  it('defaults to three minutes and keeps config within 30 s – 30 min', () => {
    expect(reconnectGraceSeconds(undefined)).toBe(180);
    expect(reconnectGraceSeconds('')).toBe(180);
    expect(reconnectGraceSeconds('abc')).toBe(180);
    expect(reconnectGraceSeconds('300')).toBe(300);
    expect(reconnectGraceSeconds(5)).toBe(30);
    expect(reconnectGraceSeconds(99_999)).toBe(1800);
  });
});

describe('OBS stops and starts again (B-28)', () => {
  let world: ReturnType<typeof makeWorld>;
  beforeEach(() => { world = makeWorld(); });
  afterEach(() => world.svc.onModuleDestroy());

  async function goLive() {
    expect(await world.svc.validateStream(KEY)).toBe(true);
    expect(world.lec.status).toBe('LIVE');
  }

  it('the class stays live when OBS stops, and the key still works', async () => {
    await goLive();
    await world.svc.streamEnded(KEY);
    expect(world.lec.status).toBe('LIVE');
    expect(world.lec.streamStoppedAt).not.toBeNull();
    expect(world.published(SCHOOL_LIVE_CHANNELS.STREAM_INTERRUPTED)).toBe(1);
    expect(world.published(SCHOOL_LIVE_CHANNELS.ENDED)).toBe(0);
    expect(world.queue.add).not.toHaveBeenCalled();
  });

  it('OBS reconnecting within the grace resumes the class: same start, no second notification', async () => {
    await goLive();
    const startedAt = world.lec.startedAt;
    const notified = world.notifications.create.mock.calls.length;
    expect(notified).toBeGreaterThan(0);

    await world.svc.streamEnded(KEY);
    world.advance(60);
    expect(await world.svc.validateStream(KEY)).toBe(true);
    expect(world.lec).toMatchObject({ status: 'LIVE', startedAt, streamStoppedAt: null });
    expect(world.notifications.create.mock.calls.length).toBe(notified);

    world.advance(GRACE);
    expect(await world.svc.finalizeStoppedStreams()).toEqual([]);
    expect(world.lec.status).toBe('LIVE');
  });

  it('when OBS does not come back, the class ends after the grace and is recorded once', async () => {
    await goLive();
    await world.svc.streamEnded(KEY);
    const stoppedAt = world.lec.streamStoppedAt;

    world.advance(GRACE - 10);
    expect(await world.svc.finalizeStoppedStreams()).toEqual([]);
    expect(world.lec.status).toBe('LIVE');

    world.advance(20);
    expect(await world.svc.finalizeStoppedStreams()).toEqual([LECTURE_ID]);
    expect(world.lec).toMatchObject({ status: 'ENDED', endedAt: stoppedAt });
    expect(world.published(SCHOOL_LIVE_CHANNELS.ENDED)).toBe(1);
    expect(world.queue.add).toHaveBeenCalledTimes(1);
    expect(world.queue.add.mock.calls[0][1]).toMatchObject({ lectureId: LECTURE_ID, streamKey: KEY, vertical: 'school' });

    expect(await world.svc.finalizeStoppedStreams()).toEqual([]);
    expect(world.queue.add).toHaveBeenCalledTimes(1);
    expect(await world.svc.validateStream(KEY)).toBe(false);
  });

  it('the timer ends the class by itself once the grace runs out', async () => {
    jest.useFakeTimers();
    try {
      await goLive();
      await world.svc.streamEnded(KEY);
      world.advance(GRACE + 5);
      jest.advanceTimersByTime((GRACE + 5) * 1000);
      jest.useRealTimers();
      await new Promise((r) => setImmediate(r));
      expect(world.lec.status).toBe('ENDED');
      expect(world.queue.add).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('End Class while OBS is reconnecting ends at once and records', async () => {
    await goLive();
    await world.svc.streamEnded(KEY);
    world.advance(30);
    expect(await world.svc.endLecture(TEACHER as any, LECTURE_ID)).toEqual({ success: true, status: 'ENDED' });
    expect(world.queue.add).toHaveBeenCalledTimes(1);
    world.advance(GRACE);
    expect(await world.svc.finalizeStoppedStreams()).toEqual([]);
    expect(world.queue.add).toHaveBeenCalledTimes(1);
  });

  it('End Class while OBS is streaming records when OBS stops', async () => {
    await goLive();
    expect(await world.svc.endLecture(TEACHER as any, LECTURE_ID)).toEqual({ success: true, status: 'ENDED' });
    expect(world.queue.add).not.toHaveBeenCalled();
    await world.svc.streamEnded(KEY);
    expect(world.queue.add).toHaveBeenCalledTimes(1);
    expect(world.lec.status).toBe('ENDED');
  });
});

describe('a student connected twice (B-32)', () => {
  const SECRET = 'grace-spec-secret';
  let prev: string | undefined;
  beforeAll(() => { prev = process.env.SCHOOL_JWT_SECRET; process.env.SCHOOL_JWT_SECRET = SECRET; });
  afterAll(() => { if (prev === undefined) delete process.env.SCHOOL_JWT_SECRET; else process.env.SCHOOL_JWT_SECRET = prev; });

  function makeGateway() {
    const svc = {
      getLecture: jest.fn(async () => ({ id: 'l1', instituteId: 'inst', status: 'LIVE', chatEnabled: true })),
      getUserDisplayName: jest.fn(async (_id: string, name: string) => name),
      trackJoin: jest.fn(async () => undefined),
      trackLeave: jest.fn(async () => undefined),
      setHandRaised: jest.fn(async () => undefined),
      reconnectGraceSeconds: 180,
    };
    const redis = {
      addViewer: jest.fn(async () => 1), removeViewer: jest.fn(async () => 0),
      viewerCount: jest.fn(async () => 1), subscribe: jest.fn(),
    };
    const gw = new SchoolLiveGateway(svc as any, redis as any);
    gw.server = { to: () => ({ emit: () => undefined }) } as any;
    const socket = (id: string) => ({ id, data: {}, join: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
    const token = jwt.sign({ id: 'stu-1', name: 'Asha', role: 'STUDENT', instituteId: 'inst' }, SECRET);
    const present = () => (gw as any).getActiveStudents('l1').map((s: any) => s.userId);
    return { gw, svc, redis, socket, token, present };
  }

  it('closing one of two tabs keeps the student in the class', async () => {
    const { gw, svc, redis, socket, token, present } = makeGateway();
    const older = socket('sock-old');
    const newer = socket('sock-new');
    await gw.handleJoin(older as any, { token, lectureId: 'l1' });
    await gw.handleJoin(newer as any, { token, lectureId: 'l1' });

    await gw.handleDisconnect(newer as any);
    expect(present()).toEqual(['stu-1']);
    expect(redis.removeViewer).not.toHaveBeenCalled();
    expect(svc.trackLeave).not.toHaveBeenCalled();

    await gw.handleDisconnect(older as any);
    expect(present()).toEqual([]);
    expect(redis.removeViewer).toHaveBeenCalledWith('l1', 'stu-1');
    expect(svc.trackLeave).toHaveBeenCalledTimes(1);
  });
});
