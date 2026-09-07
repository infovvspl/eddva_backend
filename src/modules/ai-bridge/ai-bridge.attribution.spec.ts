import { of } from 'rxjs';
import { AiBridgeService } from './ai-bridge.service';
import { aiRequestStorage } from '../../common/context/ai-request-context';
import { AdmissionPool } from '../../common/services/ai-admission.constants';

/**
 * P1-6: AiBridgeService forwards the authenticated identity from the request
 * ALS context as X-User-Id / X-User-Role / X-Request-Id, and omits them for
 * system calls made outside any request.
 */
describe('AiBridgeService — attribution forwarding', () => {
  let http: { post: jest.Mock };
  let aiUsage: { checkQuota: jest.Mock; record: jest.Mock; recordProviderEvent: jest.Mock };
  let admission: { acquire: jest.Mock; release: jest.Mock };
  let svc: AiBridgeService;

  const cfg = { get: (k: string) => ({ 'ai.baseUrl': 'http://ai', 'ai.apiKey': 'K', 'ai.timeoutMs': 1000 }[k]) };
  const lastHeaders = () => http.post.mock.calls[0][2].headers as Record<string, string>;

  beforeEach(() => {
    http = { post: jest.fn().mockReturnValue(of({ data: { ok: true } })) };
    aiUsage = {
      checkQuota: jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: 100 }),
      record: jest.fn(),
      recordProviderEvent: jest.fn(),
    };
    // P0-4.4: admission is stubbed out here so this suite keeps testing exactly
    // one thing — attribution header forwarding. Admission itself is covered by
    // ai-admission.service.spec.ts.
    admission = { acquire: jest.fn().mockResolvedValue(null), release: jest.fn().mockResolvedValue(undefined) };
    svc = new AiBridgeService(http as any, cfg as any, aiUsage as any, admission as any);
  });

  it('forwards X-User-Id / X-User-Role / X-Request-Id from the request context', async () => {
    await aiRequestStorage.run(
      { userId: 'teacher-9', userRole: 'TEACHER', requestId: 'req-42' },
      () => svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, '11111111-1111-1111-1111-111111111111'),
    );
    const h = lastHeaders();
    expect(h['X-User-Id']).toBe('teacher-9');
    expect(h['X-User-Role']).toBe('TEACHER');
    expect(h['X-Request-Id']).toBe('req-42');
    expect(h['X-Tenant-ID']).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('system call (no request context) omits user headers but still sends a request id', async () => {
    await svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, '11111111-1111-1111-1111-111111111111');
    const h = lastHeaders();
    expect(h['X-User-Id']).toBeUndefined();
    expect(h['X-User-Role']).toBeUndefined();
    expect(h['X-Request-Id']).toBeTruthy(); // minted fallback
  });

  it('failure path records attribution + a provider event', async () => {
    const { Observable } = require('rxjs');
    http.post.mockReturnValueOnce(
      new Observable((s: any) => s.error({ response: { status: 429 }, code: 'ERR' })),
    );
    await aiRequestStorage.run(
      { userId: 'student-3', userRole: 'STUDENT', requestId: 'req-err' },
      async () => {
        await expect(
          svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, '11111111-1111-1111-1111-111111111111'),
        ).rejects.toBeTruthy();
      },
    );
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, userId: 'student-3', userRole: 'STUDENT', requestId: 'req-err' }),
    );
    expect(aiUsage.recordProviderEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: '429', requestId: 'req-err' }),
    );
  });

  // ── P0-4.4: admission uses the TRUSTED context identity, and always releases ──
  it('P0-4.4: passes the trusted instituteId from the ALS context to admission', async () => {
    await aiRequestStorage.run(
      { userId: 'teacher-9', userRole: 'TEACHER', requestId: 'req-42', instituteId: 'inst-trusted-1' },
      () => svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, 'tenant-param-DIFFERENT'),
    );
    expect(admission.acquire).toHaveBeenCalledTimes(1);
    const [, tenantArg] = admission.acquire.mock.calls[0];
    // The trusted ALS value wins over the tenantId PARAMETER, which upstream may
    // have resolved from a client-supplied x-tenant-id header.
    expect(tenantArg).toBe('inst-trusted-1');
    expect(tenantArg).not.toBe('tenant-param-DIFFERENT');
  });

  it('P0-4.4: no trusted identity in context yields null, so the service fails closed', async () => {
    await aiRequestStorage.run(
      { userId: 'u', userRole: 'TEACHER', requestId: 'r' },
      () => svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, 'tenant-param-DIFFERENT'),
    );
    const [, tenantArg] = admission.acquire.mock.calls[0];
    expect(tenantArg).toBeNull();
  });

  it('P0-4.4: releases the slot on success', async () => {
    await svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, 'inst-1');
    expect(admission.release).toHaveBeenCalledTimes(1);
  });

  it('P0-4.4: releases the slot when the upstream call throws', async () => {
    http.post.mockImplementation(() => { throw new Error('django down'); });
    await expect(
      svc.getContentRecommendations({ studentId: 's', context: 'dashboard' }, 'inst-1'),
    ).rejects.toThrow('django down');
    expect(admission.release).toHaveBeenCalledTimes(1);
  });

  // ── P0-4.5 (G1): background lecture work must not take an interactive slot ──
  it('G1: a normal /translate call stays INTERACTIVE', async () => {
    await svc.translateText({ text: 'hola', targetLanguage: 'en' }, 'inst-1');
    expect(admission.acquire).toHaveBeenCalledTimes(1);
    const [pool] = admission.acquire.mock.calls[0];
    expect(pool).toBe(AdmissionPool.INTERACTIVE);
  });

  it('G1: lecture enrichment translate is routed to BACKGROUND', async () => {
    await svc.translateText(
      { text: 'ଓଡ଼ିଆ', targetLanguage: 'en' },
      'inst-1',
      { pool: AdmissionPool.BACKGROUND },
    );
    const [pool] = admission.acquire.mock.calls[0];
    expect(pool).toBe(AdmissionPool.BACKGROUND);
    expect(pool).not.toBe(AdmissionPool.INTERACTIVE);
  });

  it('G1: the pool override is a server-side argument, never taken from body or headers', async () => {
    // A client-supplied "pool" in the request body must be inert.
    await svc.translateText({ text: 'x', targetLanguage: 'en', pool: 'interactive' } as any, 'inst-1');
    const [pool] = admission.acquire.mock.calls[0];
    expect(pool).toBe(AdmissionPool.INTERACTIVE); // from classifyPath, not from the body
    // and the body value cannot force BACKGROUND -> INTERACTIVE either
    admission.acquire.mockClear();
    await svc.translateText(
      { text: 'x', targetLanguage: 'en', pool: 'interactive' } as any,
      'inst-1',
      { pool: AdmissionPool.BACKGROUND },
    );
    expect(admission.acquire.mock.calls[0][0]).toBe(AdmissionPool.BACKGROUND);
  });

  it('G1: interactive paths are unaffected by the override plumbing', async () => {
    await svc.resolveDoubt({ questionText: 'q' } as any, 'inst-1');
    expect(admission.acquire.mock.calls[0][0]).toBe(AdmissionPool.INTERACTIVE);
  });
});
