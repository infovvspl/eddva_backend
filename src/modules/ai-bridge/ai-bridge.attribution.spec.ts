import { of } from 'rxjs';
import { AiBridgeService } from './ai-bridge.service';
import { aiRequestStorage } from '../../common/context/ai-request-context';

/**
 * P1-6: AiBridgeService forwards the authenticated identity from the request
 * ALS context as X-User-Id / X-User-Role / X-Request-Id, and omits them for
 * system calls made outside any request.
 */
describe('AiBridgeService — attribution forwarding', () => {
  let http: { post: jest.Mock };
  let aiUsage: { checkQuota: jest.Mock; record: jest.Mock; recordProviderEvent: jest.Mock };
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
    svc = new AiBridgeService(http as any, cfg as any, aiUsage as any);
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
});
