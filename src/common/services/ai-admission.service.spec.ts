import { HttpException, HttpStatus } from '@nestjs/common';
import { AiAdmissionService } from './ai-admission.service';
import {
  AdmissionPool,
  classifyPath,
  ADMISSION_EXEMPT_PATHS,
  ADMISSION_REJECTED_CODE,
  ADMISSION_UNAVAILABLE_CODE,
  ADMISSION_NO_TENANT_CODE,
  ADMISSION_LEASE_MARGIN_MS,
} from './ai-admission.constants';

/**
 * P0-4.4 admission control — unit tests.
 *
 * The Redis client is replaced by a FAKE that actually executes the semantics of
 * the two Lua scripts against in-memory sorted sets. That matters: asserting
 * against a mock that always returns 1 would prove nothing about the limit. This
 * fake enforces caps, leases and token-scoped release for real, so the cap tests
 * genuinely exercise the algorithm.
 */
class FakeRedis {
  zsets = new Map<string, Map<string, number>>();
  ready = true;
  evalCalls = 0;
  failWith: Error | null = null;
  delayMs = 0;

  private z(key: string) {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map());
    return this.zsets.get(key)!;
  }
  card(key: string) { return this.z(key).size; }

  async eval(script: string, opts: { keys: string[]; arguments: string[] }): Promise<number> {
    this.evalCalls++;
    if (this.failWith) throw this.failWith;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));

    const [gKey, tKey] = opts.keys;
    if (script.includes('ZREM') && !script.includes('ZADD')) {
      const token = opts.arguments[0];
      this.z(gKey).delete(token);
      this.z(tKey).delete(token);
      return 1;
    }
    const [nowS, gCapS, tCapS, leaseS, token] = opts.arguments;
    const now = Number(nowS);
    for (const k of [gKey, tKey]) {
      for (const [m, exp] of [...this.z(k)]) if (exp <= now) this.z(k).delete(m);
    }
    if (this.card(gKey) >= Number(gCapS)) return 0;
    if (this.card(tKey) >= Number(tCapS)) return -1;
    const expiry = now + Number(leaseS);
    this.z(gKey).set(token, expiry);
    this.z(tKey).set(token, expiry);
    return 1;
  }
  async zRemRangeByScore() { return 0; }
  async zCard(key: string) { return this.card(key); }
  on() { /* noop */ }
  async quit() { /* noop */ }
}

const CFG: Record<string, any> = {
  'aiAdmission.enabled': true,
  'aiAdmission.namespace': 'test-3000',
  'aiAdmission.redisOpTimeoutMs': 200,
  'aiAdmission.interactiveGlobal': 2,
  'aiAdmission.backgroundGlobal': 1,
  'aiAdmission.interactiveTenant': 1,
  'aiAdmission.backgroundTenant': 1,
  'aiAdmission.interactiveWaitMs': 60,
  'aiAdmission.backgroundWaitMs': 60,
  'aiAdmission.interactiveRetryAfterSec': 3,
  'aiAdmission.backgroundRetryAfterSec': 15,
  'redis.host': 'localhost',
  'redis.port': 6379,
  'redis.password': undefined,
};

const T_A = 'inst-aaaa-1111';
const T_B = 'inst-bbbb-2222';
const TIMEOUT = 240_000;

function makeService(fake: FakeRedis, overrides: Record<string, any> = {}) {
  const cfg = { get: (k: string) => (k in overrides ? overrides[k] : CFG[k]) } as any;
  const svc = new AiAdmissionService(cfg);
  (svc as any).client = fake;
  (svc as any).clientReady = fake.ready;
  return svc;
}

const acquire = (svc: AiAdmissionService, pool: AdmissionPool, tenant: string | null, rid = 'req-1') =>
  svc.acquire(pool, tenant, TIMEOUT, rid, 'test_feature');

describe('P0-4.4 — AiAdmissionService', () => {
  let fake: FakeRedis;
  let svc: AiAdmissionService;

  beforeEach(() => {
    fake = new FakeRedis();
    svc = makeService(fake);
    jest.spyOn(svc['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined);
  });

  // ── classification ────────────────────────────────────────────────────────
  describe('workload classification', () => {
    it('classifies interactive paths', () => {
      expect(classifyPath('/doubt/resolve')).toBe(AdmissionPool.INTERACTIVE);
      expect(classifyPath('/tutor/session')).toBe(AdmissionPool.INTERACTIVE);
      expect(classifyPath('/tutor/continue')).toBe(AdmissionPool.INTERACTIVE);
    });
    it('classifies background paths, including sync-HTTP PPT/test', () => {
      expect(classifyPath('/stt/transcribe')).toBe(AdmissionPool.BACKGROUND);
      expect(classifyPath('/stt/notes')).toBe(AdmissionPool.BACKGROUND);
      expect(classifyPath('/ppt/generate')).toBe(AdmissionPool.BACKGROUND);
      expect(classifyPath('/test/generate/')).toBe(AdmissionPool.BACKGROUND);
    });
    it('defaults unknown paths to BACKGROUND so the interactive guarantee holds', () => {
      expect(classifyPath('/some/unaudited/path')).toBe(AdmissionPool.BACKGROUND);
    });
    it('exempts /health', () => {
      expect(ADMISSION_EXEMPT_PATHS.has('/health')).toBe(true);
    });
  });

  // ── 1,2 global interactive limit ──────────────────────────────────────────
  it('1+2. admits 2 interactive globally and rejects the 3rd with 429', async () => {
    const a = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    const b = await acquire(svc, AdmissionPool.INTERACTIVE, T_B);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();

    await expect(acquire(svc, AdmissionPool.INTERACTIVE, 'inst-cccc-3333')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    try {
      await acquire(svc, AdmissionPool.INTERACTIVE, 'inst-dddd-4444');
    } catch (e: any) {
      expect(e.getResponse().error).toBe(ADMISSION_REJECTED_CODE);
      expect(e.getResponse().reason).toBe('global_full');
      expect(e.getResponse().retryAfterSeconds).toBe(3);
    }
  });

  // ── 3,4 global background limit ───────────────────────────────────────────
  it('3+4. admits only 1 background globally; the 2nd waits then is rejected', async () => {
    const a = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(a).toBeTruthy();

    const started = Date.now();
    await expect(acquire(svc, AdmissionPool.BACKGROUND, T_B)).rejects.toBeInstanceOf(HttpException);
    // It waited (bounded) rather than failing instantly, and polled more than once.
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(fake.evalCalls).toBeGreaterThan(2);
  });

  // ── 5 THE CORE INVARIANT ──────────────────────────────────────────────────
  it('5. interactive is still admitted while background is saturated', async () => {
    const bg = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(bg).toBeTruthy();
    await expect(acquire(svc, AdmissionPool.BACKGROUND, T_B)).rejects.toBeInstanceOf(HttpException);

    // Background full must NOT consume interactive capacity.
    const i1 = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    const i2 = await acquire(svc, AdmissionPool.INTERACTIVE, T_B);
    expect(i1).toBeTruthy();
    expect(i2).toBeTruthy();
  });

  // ── 6,7,8 tenant isolation ────────────────────────────────────────────────
  it('6. per-tenant interactive cap (1) blocks the same tenant twice', async () => {
    await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    try {
      await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
      fail('expected rejection');
    } catch (e: any) {
      expect(e.getResponse().reason).toBe('tenant_full');
    }
  });

  it('7. tenant A cannot consume tenant B capacity', async () => {
    await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    await expect(acquire(svc, AdmissionPool.INTERACTIVE, T_A)).rejects.toBeInstanceOf(HttpException);
    // B is unaffected by A exhausting its own tenant cap.
    await expect(acquire(svc, AdmissionPool.INTERACTIVE, T_B)).resolves.toBeTruthy();
  });

  it('8. two tenants use independent capacity', async () => {
    const a = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    const b = await acquire(svc, AdmissionPool.INTERACTIVE, T_B);
    expect(a!.token).not.toBe(b!.token);
    expect(fake.card('ai-admission:test-3000:interactive')).toBe(2);
    expect(fake.card(`ai-admission:test-3000:interactive:t:${T_A}`)).toBe(1);
    expect(fake.card(`ai-admission:test-3000:interactive:t:${T_B}`)).toBe(1);
  });

  // ── 9,10,11 release ───────────────────────────────────────────────────────
  it('9. slot released after success frees capacity', async () => {
    const t = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    await svc.release(t, 'req-1');
    expect(fake.card('ai-admission:test-3000:background')).toBe(0);
    await expect(acquire(svc, AdmissionPool.BACKGROUND, T_B)).resolves.toBeTruthy();
  });

  it('10+11. release is safe to call after an exception or timeout path', async () => {
    const t = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    await expect(svc.release(t, 'req-err')).resolves.toBeUndefined();
    expect(fake.card('ai-admission:test-3000:interactive')).toBe(0);
    // Releasing twice must not throw or corrupt state.
    await expect(svc.release(t, 'req-err')).resolves.toBeUndefined();
    expect(fake.card('ai-admission:test-3000:interactive')).toBe(0);
  });

  it('release never throws when Redis is down (lease is the backstop)', async () => {
    const t = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    (svc as any).clientReady = false;
    await expect(svc.release(t, 'req-1')).resolves.toBeUndefined();
  });

  // ── 12 holder scoping ─────────────────────────────────────────────────────
  it('12. a holder cannot release another holder\'s slot', async () => {
    const a = await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    const b = await acquire(svc, AdmissionPool.INTERACTIVE, T_B);
    await svc.release(a, 'req-a');

    // A's release removed only A's token; B still holds its slot.
    const gKey = 'ai-admission:test-3000:interactive';
    expect(fake.card(gKey)).toBe(1);
    expect([...fake.zsets.get(gKey)!.keys()]).toEqual([b!.token]);
    expect(fake.card(`ai-admission:test-3000:interactive:t:${T_B}`)).toBe(1);
  });

  // ── 13 atomicity under concurrency ────────────────────────────────────────
  it('13. concurrent acquisition never exceeds the cap', async () => {
    const results = await Promise.allSettled([
      acquire(svc, AdmissionPool.INTERACTIVE, 'i-1'),
      acquire(svc, AdmissionPool.INTERACTIVE, 'i-2'),
      acquire(svc, AdmissionPool.INTERACTIVE, 'i-3'),
      acquire(svc, AdmissionPool.INTERACTIVE, 'i-4'),
    ]);
    const admitted = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    expect(admitted).toBe(2); // global interactive cap
    expect(fake.card('ai-admission:test-3000:interactive')).toBe(2);
  });

  // ── 14,15 Redis failure → FAIL CLOSED ─────────────────────────────────────
  it('14. Redis unavailable fails CLOSED with 503 + retry hint', async () => {
    (svc as any).clientReady = false;
    try {
      await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
      fail('expected fail-closed');
    } catch (e: any) {
      expect(e.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(e.getResponse().error).toBe(ADMISSION_UNAVAILABLE_CODE);
      expect(e.getResponse().retryAfterSeconds).toBe(3);
    }
  });

  it('15. Redis error/timeout fails CLOSED, never silently admits', async () => {
    fake.failWith = new Error('ECONNREFUSED');
    await expect(acquire(svc, AdmissionPool.INTERACTIVE, T_A)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('15b. a slow Redis is bounded by the op timeout and fails closed', async () => {
    fake.delayMs = 400; // > redisOpTimeoutMs (200)
    await expect(acquire(svc, AdmissionPool.INTERACTIVE, T_A)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  // ── 16 multi-instance ─────────────────────────────────────────────────────
  it('16. two NestJS instances sharing Redis share one global limit', async () => {
    const svcB = makeService(fake); // same fake Redis = same shared state
    jest.spyOn(svcB['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(svcB['logger'], 'warn').mockImplementation(() => undefined);

    await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    await acquire(svcB, AdmissionPool.INTERACTIVE, T_B);
    // The cap is global, not per process — an in-process counter would admit 4.
    await expect(acquire(svcB, AdmissionPool.INTERACTIVE, 'i-9')).rejects.toBeInstanceOf(HttpException);
    expect(fake.card('ai-admission:test-3000:interactive')).toBe(2);
  });

  // ── 17,18 trusted identity ────────────────────────────────────────────────
  it('17+18. missing trusted tenant identity fails CLOSED (never a shared bucket)', async () => {
    try {
      await acquire(svc, AdmissionPool.INTERACTIVE, null);
      fail('expected rejection');
    } catch (e: any) {
      expect(e.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(e.getResponse().error).toBe(ADMISSION_NO_TENANT_CODE);
    }
    // Nothing was admitted under any key.
    expect(fake.zsets.size).toBe(0);
  });

  it('18b. the admission key is derived from the tenant id passed in, so two ids never collide', async () => {
    await acquire(svc, AdmissionPool.INTERACTIVE, T_A);
    expect([...fake.zsets.keys()]).toContain(`ai-admission:test-3000:interactive:t:${T_A}`);
    expect([...fake.zsets.keys()]).not.toContain(`ai-admission:test-3000:interactive:t:${T_B}`);
  });

  // ── namespace / lease / logging hygiene ───────────────────────────────────
  it('namespaces keys so DEV and PROD cannot share admission state', async () => {
    const prod = makeService(new FakeRedis(), { ...CFG, 'aiAdmission.namespace': 'production-3000' });
    jest.spyOn(prod['logger'], 'log').mockImplementation(() => undefined);
    const t = await acquire(prod, AdmissionPool.INTERACTIVE, T_A);
    expect(t!.globalKey).toBe('ai-admission:production-3000:interactive');
    expect(t!.globalKey).not.toContain('test-3000');
  });

  it('lease is derived from the call timeout, never a short fixed TTL', async () => {
    await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    const expiry = [...fake.zsets.get('ai-admission:test-3000:background')!.values()][0];
    const leaseMs = expiry - Date.now();
    // 240s call timeout + 60s margin, minus a little execution time.
    expect(leaseMs).toBeGreaterThan(TIMEOUT);
    expect(leaseMs).toBeLessThanOrEqual(TIMEOUT + ADMISSION_LEASE_MARGIN_MS + 50);
  });

  it('an expired lease reclaims a leaked slot', async () => {
    await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    // Simulate a SIGKILLed holder whose lease has since expired.
    const key = 'ai-admission:test-3000:background';
    for (const k of fake.zsets.get(key)!.keys()) fake.zsets.get(key)!.set(k, Date.now() - 1);
    await expect(acquire(svc, AdmissionPool.BACKGROUND, T_B)).resolves.toBeTruthy();
  });

  it('never logs a raw tenant id — only a short hash', () => {
    const h = svc.tenantHash(T_A);
    expect(h).toHaveLength(12);
    expect(h).not.toContain(T_A);
    expect(svc.tenantHash(null)).toBe('none');
  });

  it('disabled admission is a no-op passthrough', async () => {
    const off = makeService(fake, { ...CFG, 'aiAdmission.enabled': false });
    jest.spyOn(off['logger'], 'warn').mockImplementation(() => undefined);
    await expect(acquire(off, AdmissionPool.INTERACTIVE, T_A)).resolves.toBeNull();
  });
});

// ── P0-4.5 (G2): same-tenant background self-contention ──────────────────────
describe('P0-4.5 (G2) — serialised background calls for one tenant', () => {
  let fake: FakeRedis;
  let svc: AiAdmissionService;

  beforeEach(() => {
    fake = new FakeRedis();
    svc = makeService(fake);
    jest.spyOn(svc['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(svc['logger'], 'error').mockImplementation(() => undefined);
  });

  it('reproduces the defect: two PARALLEL background calls for one tenant — only one is admitted', async () => {
    const results = await Promise.allSettled([
      acquire(svc, AdmissionPool.BACKGROUND, T_A),
      acquire(svc, AdmissionPool.BACKGROUND, T_A),
    ]);
    const admitted = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(admitted).toBe(1);
    expect(rejected).toBe(1); // this was the silent 60s wait + 429 in battle.service
  });

  it('the fix: SERIALISED background calls for one tenant both succeed', async () => {
    const first = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(first).toBeTruthy();
    await svc.release(first, 'req-1');

    const second = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(second).toBeTruthy();
    expect(second!.token).not.toBe(first!.token);
    await svc.release(second, 'req-2');
  });

  it('serialised calls never wait for admission — the slot is free each time', async () => {
    const a = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(a!.waitedMs).toBeLessThan(50);
    await svc.release(a, 'r');
    const b = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    expect(b!.waitedMs).toBeLessThan(50); // no 60s admission wait
  });

  it('a failure in the first call does not consume the slot for the second', async () => {
    const a = await acquire(svc, AdmissionPool.BACKGROUND, T_A);
    // caller throws -> post()'s finally still releases
    await svc.release(a, 'r-failed');
    await expect(acquire(svc, AdmissionPool.BACKGROUND, T_A)).resolves.toBeTruthy();
  });

  it('battle.service.ts serialises its two background AI calls (source guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'modules', 'battle', 'battle.service.ts'), 'utf8');
    const start = src.indexOf('const seed = Math.floor(Math.random() * 1000000);');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 3000);
    // the two AI calls must no longer be launched together
    expect(block).not.toContain('Promise.allSettled([');
    expect(block).toContain('const notesResult = await settle(');
    expect(block).toContain('const topicResult = await settle(');
    // graceful degradation must be preserved
    expect(block).toContain("notesResult.status === 'fulfilled'");
    expect(block).toContain("topicResult.status === 'fulfilled'");
  });
});
