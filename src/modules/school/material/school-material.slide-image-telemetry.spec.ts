/**
 * P1-C2 — telemetry for school FLUX slide-image generation.
 *
 * The path called Hugging Face with no observability at all, so a dead model or
 * runaway spend would have been invisible. It now uses the existing EDVA
 * telemetry contract, unchanged: one ai_usage_events row per logical request
 * (AiUsageService.record) plus attempt-level ai_provider_events rows
 * (recordProviderEvent) — exactly what AiBridgeService does.
 *
 * Identity comes only from the P1-6 ALS context. No test performs network I/O.
 */
import { BadRequestException } from '@nestjs/common';

import { SchoolMaterialService } from './school-material.service';
import { aiRequestStorage } from '../../../common/context/ai-request-context';

const INSTITUTE = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const TEACHER = { id: USER, role: 'TEACHER', instituteId: INSTITUTE };
const CTX = { userId: USER, userRole: 'TEACHER', instituteId: INSTITUTE, requestId: 'req-abc' };

const imageResponse = () => ({
  ok: true,
  status: 200,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
  arrayBuffer: async () => new Uint8Array(2048).buffer,
});

const errorResponse = (status: number, contentType = 'application/json') => ({
  ok: false,
  status,
  headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  json: async () => ({ estimated_time: 0.001 }),
  text: async () => 'upstream detail',
});

function makeService(opts: { exists?: boolean } = {}) {
  const s3 = {
    exists: jest.fn(async (_k: string) => !!opts.exists),
    upload: jest.fn(async (_k: string, _b: Buffer, _c: string) => 'https://cdn.example/x.png'),
    toPublicUrl: jest.fn((k: string) => `https://cdn.example/${k}`),
  };
  const aiUsage = {
    record: jest.fn(async (_ev: any) => undefined),
    recordProviderEvent: jest.fn(async (_ev: any) => undefined),
  };
  const svc: any = new SchoolMaterialService(
    { query: jest.fn() } as any, s3 as any, {} as any, {} as any, {} as any, {} as any,
    aiUsage as any,
  );
  return { svc, s3, aiUsage };
}

/** Run inside the ALS scope the AiContextInterceptor establishes per request. */
const withCtx = <T>(fn: () => Promise<T>, ctx: any = CTX) => aiRequestStorage.run(ctx, fn);

const usageOf = (aiUsage: any) => aiUsage.record.mock.calls[0][0];

describe('P1-C2 — slide-image telemetry', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.HF_TOKEN = 'test-token';
    delete process.env.HF_IMAGE_MODEL;
    fetchMock = jest.fn(async () => imageResponse());
    (global as any).fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (global as any).fetch = realFetch;
    jest.restoreAllMocks();
  });

  // ── A. Success ──────────────────────────────────────────────────────────
  describe('A. success', () => {
    it('1. records exactly one usage event with the right provider/feature/model', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'a cell diagram' }));

      expect(aiUsage.record).toHaveBeenCalledTimes(1);
      const ev = usageOf(aiUsage);
      expect(ev.provider).toBe('huggingface');
      expect(ev.feature).toBe('slide_image_generation');
      expect(ev.model).toBe('black-forest-labs/FLUX.1-schnell');
      expect(ev.vertical).toBe('school');
      expect(ev.success).toBe(true);
      expect(ev.statusCode).toBe(200);
    });

    it('2. uses the configured HF_IMAGE_MODEL when set', async () => {
      process.env.HF_IMAGE_MODEL = 'some-org/some-other-model';
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      expect(usageOf(aiUsage).model).toBe('some-org/some-other-model');
    });

    it('3. records provider latency as a number', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      const ev = usageOf(aiUsage);
      expect(typeof ev.latencyMs).toBe('number');
      expect(ev.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('4. invents no token counts and uses the non-token unit dimension', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      const ev = usageOf(aiUsage);
      // Fabricated tokens would corrupt every token-based rollup over this table.
      expect(ev.promptTokens ?? null).toBeNull();
      expect(ev.completionTokens ?? null).toBeNull();
      expect(ev.totalTokens ?? null).toBeNull();
      expect(ev.units).toBe(1);
      expect(ev.unitType).toBe('request');
    });

    it('5. emits no provider-event rows on a clean success', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      expect(aiUsage.recordProviderEvent).not.toHaveBeenCalled();
    });
  });

  // ── B. Failures ─────────────────────────────────────────────────────────
  describe('B. failure', () => {
    const failCases: Array<[string, () => void, number | null]> = [
      ['timeout', () => fetchMock.mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'TimeoutError' })), null],
      ['network exception', () => fetchMock.mockRejectedValue(new Error('ECONNRESET')), null],
      ['4xx', () => fetchMock.mockResolvedValue(errorResponse(401)), 401],
      ['5xx', () => fetchMock.mockResolvedValue(errorResponse(500)), 500],
      ['429', () => fetchMock.mockResolvedValue(errorResponse(429)), 429],
    ];

    it.each(failCases)('6. %s records a failure usage event', async (_name, arrange, status) => {
      arrange();
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' })))
        .rejects.toBeInstanceOf(BadRequestException);

      expect(aiUsage.record).toHaveBeenCalledTimes(1);
      const ev = usageOf(aiUsage);
      expect(ev.success).toBe(false);
      expect(ev.provider).toBe('huggingface');
      expect(ev.feature).toBe('slide_image_generation');
      expect(ev.statusCode ?? null).toBe(status);
    });

    it('7. a non-image 200 is recorded as a failure', async () => {
      fetchMock.mockResolvedValue({
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '{}',
      });
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();
      expect(usageOf(aiUsage).success).toBe(false);
    });

    it('8. a missing HF_TOKEN is recorded so a misconfigured env is visible', async () => {
      delete process.env.HF_TOKEN;
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();

      const ev = usageOf(aiUsage);
      expect(ev.success).toBe(false);
      expect(ev.statusCode ?? null).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('9. every failure emits an attempt-level provider event', async () => {
      fetchMock.mockResolvedValue(errorResponse(500));
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();

      expect(aiUsage.recordProviderEvent).toHaveBeenCalledTimes(1);
      const pe = aiUsage.recordProviderEvent.mock.calls[0][0];
      expect(pe.eventType).toBe('5xx');
      expect(pe.attemptNumber).toBe(1);
      expect(pe.requestId).toBe('req-abc');
      expect(pe.provider).toBe('huggingface');
    });

    it('10. a timeout is categorised as a timeout provider event', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();
      expect(aiUsage.recordProviderEvent.mock.calls[0][0].eventType).toBe('timeout');
    });

    it('11. a timeout still records the elapsed provider duration', async () => {
      fetchMock.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      });
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();
      expect(usageOf(aiUsage).latencyMs).toBeGreaterThan(0);
    });
  });

  // ── C. Retry visibility ─────────────────────────────────────────────────
  describe('C. retry', () => {
    it('12. 503 → retry → success: one usage row, one provider event', async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(imageResponse());
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));

      // Request-level convention: the logical request is not double counted...
      expect(aiUsage.record).toHaveBeenCalledTimes(1);
      expect(usageOf(aiUsage).success).toBe(true);
      // ...but the retry is still visible at attempt level.
      expect(aiUsage.recordProviderEvent).toHaveBeenCalledTimes(1);
      const pe = aiUsage.recordProviderEvent.mock.calls[0][0];
      expect(pe.statusCode).toBe(503);
      expect(pe.attemptNumber).toBe(1);
    });

    it('13. two 503s: still one usage row, with both attempts visible', async () => {
      fetchMock.mockResolvedValue(errorResponse(503));
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }))).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledTimes(2);           // retry behaviour unchanged
      expect(aiUsage.record).toHaveBeenCalledTimes(1);
      expect(usageOf(aiUsage).success).toBe(false);
      expect(aiUsage.recordProviderEvent).toHaveBeenCalledTimes(2);
      expect(aiUsage.recordProviderEvent.mock.calls.map((c: any[]) => c[0].attemptNumber))
        .toEqual([1, 2]);
    });
  });

  // ── D. Cache ────────────────────────────────────────────────────────────
  describe('D. cache', () => {
    it('14. a cache hit calls no provider and records no usage event', async () => {
      const { svc, aiUsage } = makeService({ exists: true });
      const res: any = await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));

      expect(res.data.cached).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(aiUsage.record).not.toHaveBeenCalled();
      expect(aiUsage.recordProviderEvent).not.toHaveBeenCalled();
    });

    it('15. a rejected prompt records nothing (no provider work happened)', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'a'.repeat(501) })))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(aiUsage.record).not.toHaveBeenCalled();
    });
  });

  // ── E. Attribution & secret safety ──────────────────────────────────────
  describe('E. attribution and secrets', () => {
    it('16. identity comes from the ALS context', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      const ev = usageOf(aiUsage);
      expect(ev.instituteId).toBe(INSTITUTE);
      expect(ev.userId).toBe(USER);
      expect(ev.userRole).toBe('TEACHER');
      expect(ev.requestId).toBe('req-abc');
    });

    it('17. body-supplied identity cannot override authenticated attribution', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, {
        prompt: 'x',
        instituteId: 'attacker-institute',
        userId: 'attacker-user',
        userRole: 'SUPER_ADMIN',
        requestId: 'attacker-request',
      } as any));

      const ev = usageOf(aiUsage);
      expect(ev.instituteId).toBe(INSTITUTE);
      expect(ev.userId).toBe(USER);
      expect(ev.userRole).toBe('TEACHER');
      expect(ev.requestId).toBe('req-abc');
      expect(JSON.stringify(ev)).not.toContain('attacker');
    });

    it('18. outside a request the event carries null identity, not fabricated values', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: 'x' });   // no ALS scope
      const ev = usageOf(aiUsage);
      expect(ev.instituteId).toBeNull();
      expect(ev.userId).toBeNull();
      expect(ev.requestId).toBeNull();
    });

    it('19. no telemetry payload contains the HF token, auth header or prompt', async () => {
      fetchMock.mockResolvedValue(errorResponse(500));
      const { svc, aiUsage } = makeService({ exists: false });
      await expect(withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'secret student name' })))
        .rejects.toThrow();

      const payloads = [
        ...aiUsage.record.mock.calls.map((c: any[]) => JSON.stringify(c[0])),
        ...aiUsage.recordProviderEvent.mock.calls.map((c: any[]) => JSON.stringify(c[0])),
      ].join(' ');
      expect(payloads).not.toContain('test-token');
      expect(payloads).not.toContain('Bearer');
      expect(payloads).not.toContain('secret student name');
      expect(payloads).not.toContain('keyHash');
    });
  });

  // ── F. Cost ─────────────────────────────────────────────────────────────
  describe('F. cost', () => {
    it('20. cost is explicitly unknown, never fabricated', async () => {
      const { svc, aiUsage } = makeService({ exists: false });
      await withCtx(() => svc.generateSlideImage(TEACHER, { prompt: 'x' }));
      const ev = usageOf(aiUsage);
      // huggingface has no rate-table entry; a number here would be invented.
      expect(ev.estCost).toBeNull();
      expect('estCost' in ev).toBe(true);   // explicit, so record() does not estimate
    });

    it('21. AiUsageService leaves an explicitly-null cost alone', () => {
      // Guards the shared change: passing estCost: null must survive; omitting
      // the key entirely must still estimate, as every existing caller relies on.
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'ai-usage', 'ai-usage.service.ts'), 'utf8',
      );
      expect(src).toContain("Object.prototype.hasOwnProperty.call(ev, 'estCost')");
      expect(src).toContain('if (!costSupplied && ev.success)');
    });
  });
});
