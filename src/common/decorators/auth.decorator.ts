import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

// ── @CurrentUser() ─────────────────────────────────────────────────────────
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

// ── @Public() — skip JWT guard on specific routes ──────────────────────────
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// ── @TenantId() — extract tenant from request ──────────────────────────────
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    // Prefer JWT tenantId for authenticated users; fall back to middleware-resolved
    return request.user?.tenantId || request.tenantId;
  },
);

// ── @ApiPaginatedResponse() — for Swagger ─────────────────────────────────
export const PAGINATION_KEY = 'pagination';
export const Paginated = () => SetMetadata(PAGINATION_KEY, true);
