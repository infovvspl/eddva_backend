import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped AI attribution (P1-6).
 *
 * The authenticated identity lives on `request.user` (set by the JWT guards),
 * but AiBridgeService is a singleton called several layers below the controller
 * (controller → service → bridge). Threading user_id/role through all 18 AI
 * services + their controllers would be a large, error-prone change. Instead a
 * single global interceptor (which runs AFTER the guards) stamps the identity
 * here once per request, and AiBridgeService reads it at call time.
 *
 * AsyncLocalStorage is a Node built-in — no new dependency — and propagates
 * across `await` boundaries, so the store set around the handler is still
 * visible when the bridge finally runs.
 *
 * A call made OUTSIDE any request (a background job, a fire-and-forget pipeline)
 * simply gets an empty store → null attribution, which is the correct, honest
 * value for a system-initiated AI call.
 */
export interface AiRequestContext {
  userId?: string | null;
  userRole?: string | null;
  requestId?: string | null;
  /**
   * P0-4.4: TRUSTED institute/tenant id for admission control.
   *
   * Set ONLY from the guard-verified `request.user` (school JWTs carry
   * `instituteId`, coaching JWTs carry `tenantId`) or, for background jobs, from
   * the institute persisted when the job was enqueued. Never from
   * `x-tenant-id` / `x-tenant-subdomain` / the request body — the P0-4.4 audit
   * found `@TenantId()` can fall back to those client-supplied headers, which
   * would let one institute consume another's admission slots.
   */
  instituteId?: string | null;
}

export const aiRequestStorage = new AsyncLocalStorage<AiRequestContext>();

/** Current request's attribution, or an empty object outside a request. */
export function getAiRequestContext(): AiRequestContext {
  return aiRequestStorage.getStore() ?? {};
}
