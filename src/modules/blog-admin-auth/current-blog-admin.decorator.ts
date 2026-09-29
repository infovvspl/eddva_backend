import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BlogAdminJwtPayload } from './blog-admin-auth.service';

/** The BlogAdminGuard-verified payload attached to the request, or one field of it. */
export const CurrentBlogAdmin = createParamDecorator(
  (data: keyof BlogAdminJwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const admin: BlogAdminJwtPayload | undefined = request.blogAdmin;
    return data ? admin?.[data] : admin;
  },
);
