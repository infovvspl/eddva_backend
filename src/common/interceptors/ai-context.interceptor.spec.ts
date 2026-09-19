import { lastValueFrom, of } from 'rxjs';
import { AiContextInterceptor } from './ai-context.interceptor';
import { getAiRequestContext } from '../context/ai-request-context';

/**
 * P1-6 security-critical: attribution must come from the guard-verified
 * request.user, never from client-supplied headers/body.
 */
function httpCtx(req: any): any {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  };
}

describe('AiContextInterceptor', () => {
  const interceptor = new AiContextInterceptor();

  it('stamps user_id/role from request.user', async () => {
    let seen: any;
    const ctx = httpCtx({ user: { id: 'user-1', role: 'TEACHER' }, headers: {} });
    const next = { handle: () => { seen = getAiRequestContext(); return of('ok'); } };
    await lastValueFrom(interceptor.intercept(ctx, next as any));
    expect(seen.userId).toBe('user-1');
    expect(seen.userRole).toBe('TEACHER');
    expect(seen.requestId).toBeTruthy();
  });

  it('IGNORES a spoofed client X-User-Id and uses the authenticated identity', async () => {
    let seen: any;
    const ctx = httpCtx({
      user: { id: 'real-student', role: 'STUDENT' },
      headers: { 'x-user-id': 'victim-teacher', 'x-user-role': 'TEACHER' },
    });
    const next = { handle: () => { seen = getAiRequestContext(); return of('ok'); } };
    await lastValueFrom(interceptor.intercept(ctx, next as any));
    expect(seen.userId).toBe('real-student');      // NOT 'victim-teacher'
    expect(seen.userRole).toBe('STUDENT');          // NOT 'TEACHER'
  });

  it('reuses an upstream x-request-id when present', async () => {
    let seen: any;
    const ctx = httpCtx({ user: { id: 'u', role: 'STUDENT' }, headers: { 'x-request-id': 'trace-123' } });
    const next = { handle: () => { seen = getAiRequestContext(); return of('ok'); } };
    await lastValueFrom(interceptor.intercept(ctx, next as any));
    expect(seen.requestId).toBe('trace-123');
  });

  it('unauthenticated request → null user, still gets a request id', async () => {
    let seen: any;
    const ctx = httpCtx({ headers: {} }); // no user
    const next = { handle: () => { seen = getAiRequestContext(); return of('ok'); } };
    await lastValueFrom(interceptor.intercept(ctx, next as any));
    expect(seen.userId).toBeNull();
    expect(seen.userRole).toBeNull();
    expect(seen.requestId).toBeTruthy();
  });

  it('non-http context passes through without touching ALS', async () => {
    const ctx: any = { getType: () => 'rpc' };
    const next = { handle: () => of('passthrough') };
    const out = await lastValueFrom(interceptor.intercept(ctx, next as any));
    expect(out).toBe('passthrough');
  });
});
