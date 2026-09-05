import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { aiRequestStorage, AiRequestContext } from '../context/ai-request-context';

/**
 * Stamps the authenticated identity into AsyncLocalStorage for the duration of
 * each HTTP request (P1-6), so AiBridgeService can attribute AI usage without
 * every controller/service passing user_id explicitly.
 *
 * Runs as a global interceptor, i.e. AFTER the JWT guards, so `request.user` is
 * populated. Only HTTP requests are wrapped; other execution contexts pass
 * through untouched (their AI calls get null attribution, which is correct).
 *
 * SECURITY: identity is taken ONLY from `request.user` (guard-verified from the
 * JWT), never from client-supplied headers or body. An inbound X-User-Id from a
 * client is ignored here and overwritten downstream by the bridge.
 */
@Injectable()
export class AiContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    const store: AiRequestContext = {
      userId: user?.id ?? null,
      userRole: user?.role ?? null,
      // Reuse an upstream correlation id if a trusted proxy set one; otherwise mint one.
      requestId: req?.headers?.['x-request-id'] || randomUUID(),
    };

    // Enter the ALS scope around the handler's SUBSCRIPTION (not just the lazy
    // next.handle() call), so the context survives the async controller/service
    // chain down to the bridge.
    return new Observable((subscriber) => {
      aiRequestStorage.run(store, () => {
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
