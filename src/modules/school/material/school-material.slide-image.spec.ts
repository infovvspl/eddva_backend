/**
 * P1-C1 — hardening for the school slide-image generation path.
 *
 * POST /school/materials/ai-slide-image calls Hugging Face (FLUX.1-schnell)
 * directly. This change adds a per-attempt timeout, a prompt ceiling and the AI
 * entitlement gate. It deliberately does NOT change the model, endpoint, cache
 * behaviour or retry policy — several tests below exist to pin exactly that.
 *
 * No test performs real network I/O: global.fetch is stubbed throughout.
 */
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { SchoolMaterialService } from './school-material.service';

const INSTITUTE = 'inst-1';
const TEACHER = { id: 'u-1', role: 'TEACHER', instituteId: INSTITUTE };

/** A response shaped like the one undici returns for a successful generation. */
function imageResponse(bytes = 8) {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

function errorResponse(status: number, contentType = 'application/json') {
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => ({ estimated_time: 0.001 }),
    text: async () => 'upstream said no',
  };
}

function makeService(opts: { exists?: boolean } = {}) {
  // Params are declared so mock.calls is typed and the key can be asserted.
  const s3 = {
    exists: jest.fn(async (_key: string) => !!opts.exists),
    upload: jest.fn(async (_key: string, _buf: Buffer, _contentType: string) =>
      'https://cdn.example/x.png'),
    toPublicUrl: jest.fn((key: string) => `https://cdn.example/${key}`),
  };
  const aiUsage = {
    record: jest.fn(async (_ev: any) => undefined),
    recordProviderEvent: jest.fn(async (_ev: any) => undefined),
  };
  const svc: any = new SchoolMaterialService(
    { query: jest.fn() } as any,   // ds
    s3 as any,                     // s3Service
    {} as any,                     // aiBridgeService
    {} as any,                     // notificationService
    {} as any,                     // featureFlagService
    {} as any,                     // textbooks
    aiUsage as any,                // aiUsageService
  );
  return { svc, s3, aiUsage };
}

describe('school slide-image generation — P1-C1 hardening', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.HF_TOKEN = 'test-token';
    fetchMock = jest.fn(async () => imageResponse());
    (global as any).fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    (global as any).fetch = realFetch;
    jest.restoreAllMocks();
  });

  // ── Baseline behaviour that must not regress ────────────────────────────
  describe('unchanged behaviour', () => {
    it('1. a valid request still reaches generation and stores the image', async () => {
      const { svc, s3 } = makeService({ exists: false });
      const res = await svc.generateSlideImage(TEACHER, { prompt: 'photosynthesis diagram' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(s3.upload).toHaveBeenCalled();
      expect(res.data.cached).toBe(false);
    });

    it('2. a cache hit short-circuits before any provider call', async () => {
      const { svc, s3 } = makeService({ exists: true });
      const res = await svc.generateSlideImage(TEACHER, { prompt: 'photosynthesis diagram' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(s3.upload).not.toHaveBeenCalled();
      expect(res.data.cached).toBe(true);
    });

    it('3. the cache key stays tenant-prefixed', async () => {
      const { svc, s3 } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: 'photosynthesis diagram' });
      expect(s3.upload.mock.calls[0][0]).toMatch(
        new RegExp(`^tenants/${INSTITUTE}/slide-images/[0-9a-f]{24}\\.png$`),
      );
    });

    it('3b. the same prompt in a different institute is a different key', async () => {
      const a = makeService({ exists: false });
      const b = makeService({ exists: false });
      await a.svc.generateSlideImage(TEACHER, { prompt: 'same prompt' });
      await b.svc.generateSlideImage({ ...TEACHER, instituteId: 'inst-2' }, { prompt: 'same prompt' });
      expect(a.s3.upload.mock.calls[0][0]).not.toEqual(b.s3.upload.mock.calls[0][0]);
    });

    it('4. instituteId comes only from the verified context, never the body', async () => {
      const { svc, s3 } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, {
        prompt: 'x',
        instituteId: 'attacker-institute',
        user: { instituteId: 'attacker-institute' },
      } as any);
      expect(s3.upload.mock.calls[0][0]).toContain(`tenants/${INSTITUTE}/`);
      expect(s3.upload.mock.calls[0][0]).not.toContain('attacker-institute');
    });

    it('5. a blank prompt is rejected before any provider call', async () => {
      const { svc } = makeService();
      for (const bad of [undefined, '', '   ']) {
        await expect(svc.generateSlideImage(TEACHER, { prompt: bad } as any))
          .rejects.toBeInstanceOf(BadRequestException);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('6. a missing HF_TOKEN is still rejected safely', async () => {
      delete process.env.HF_TOKEN;
      const { svc } = makeService({ exists: false });
      await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('7. a missing instituteId is rejected (SUPER_ADMIN has none)', async () => {
      const { svc } = makeService();
      await expect(svc.generateSlideImage({ role: 'SUPER_ADMIN' }, { prompt: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('8. the model and endpoint are unchanged', async () => {
      const { svc } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: 'x' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
      );
      expect(JSON.parse(init.body).parameters)
        .toEqual({ width: 1024, height: 768, num_inference_steps: 6 });
    });
  });

  // ── 2. Prompt limit ─────────────────────────────────────────────────────
  describe('prompt limit', () => {
    it('9. a prompt at the 500-char limit is accepted', async () => {
      const { svc } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: 'a'.repeat(500) });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('10. a prompt over the limit is rejected without calling the provider', async () => {
      const { svc, s3 } = makeService({ exists: false });
      await expect(svc.generateSlideImage(TEACHER, { prompt: 'a'.repeat(501) }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
      // Rejected before the cache is even consulted — no provider spend, no I/O.
      expect(s3.exists).not.toHaveBeenCalled();
    });

    it('11. the limit applies to the trimmed prompt, not surrounding whitespace', async () => {
      const { svc } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: `   ${'a'.repeat(500)}   ` });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── 1. Timeout ──────────────────────────────────────────────────────────
  describe('timeout', () => {
    it('12. every provider attempt carries an abort signal', async () => {
      const { svc } = makeService({ exists: false });
      await svc.generateSlideImage(TEACHER, { prompt: 'x' });
      const init = fetchMock.mock.calls[0][1];
      expect(init.signal).toBeDefined();
      expect(typeof init.signal.aborted).toBe('boolean');
    });

    it('13. an aborted request fails the generation instead of hanging', async () => {
      const abort = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      fetchMock.mockRejectedValue(abort);
      const { svc, s3 } = makeService({ exists: false });

      await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(s3.upload).not.toHaveBeenCalled();
    });

    it('14. a timeout adds no extra retry', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
      const { svc } = makeService({ exists: false });
      await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── Retry policy must be unchanged ──────────────────────────────────────
  describe('retry policy (unchanged)', () => {
    it('15. a 503 retries exactly once, then succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(imageResponse());
      const { svc, s3 } = makeService({ exists: false });

      await svc.generateSlideImage(TEACHER, { prompt: 'x' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(s3.upload).toHaveBeenCalled();
    });

    it('16. a second 503 gives up rather than looping', async () => {
      fetchMock.mockResolvedValue(errorResponse(503));
      const { svc } = makeService({ exists: false });
      await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('17. a non-503 failure is not retried', async () => {
      for (const status of [400, 401, 429, 500]) {
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(errorResponse(status));
        const { svc } = makeService({ exists: false });
        await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });

    it('18. a non-image 200 is treated as failure, not stored', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => '{}',
      });
      const { svc, s3 } = makeService({ exists: false });
      await expect(svc.generateSlideImage(TEACHER, { prompt: 'x' })).rejects.toThrow();
      expect(s3.upload).not.toHaveBeenCalled();
    });
  });

  // ── 3. Entitlement + roles (source guards) ──────────────────────────────
  describe('route metadata', () => {
    const src: string = fs.readFileSync(
      path.join(__dirname, 'school-material.controller.ts'), 'utf8',
    );
    const block = src.slice(
      src.indexOf("@Post('ai-slide-image')"),
      src.indexOf("@Post('ai-slide-image')") + 400,
    );

    it('19. the route declares the AI entitlement, matching ai-save', () => {
      expect(block).toContain("@SchoolFeature('ai', 'ai_content_generator_materials')");
    });

    it('20. roles are unchanged and STUDENT remains excluded', () => {
      expect(block).toContain("@SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')");
      const roles = block.match(/@SchoolRoles\(([^)]*)\)/)![1];
      expect(roles).not.toContain('STUDENT');
    });

    it('21. the handler passes the guard-resolved user, not request body identity', () => {
      expect(block).toContain('@SchoolUser() user: any');
      expect(block).toContain('this.svc.generateSlideImage(user, body)');
    });
  });
});
