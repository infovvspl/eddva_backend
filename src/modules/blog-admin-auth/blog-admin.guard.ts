import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { BlogAdminAuthService } from './blog-admin-auth.service';

/**
 * Guards `/blog-admin/*` management routes. Verifies a blog-admin JWT against
 * its own secret and scope — entirely independent of JwtAuthGuard/RolesGuard,
 * so an LMS super-admin token (or any other platform account) is not valid
 * here, and a blog-admin token is not valid on any LMS route either.
 */
@Injectable()
export class BlogAdminGuard implements CanActivate {
  constructor(private readonly auth: BlogAdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing blog admin session');
    }

    const token = header.slice(7);
    const payload = await this.auth.verify(token);
    req.blogAdmin = payload;
    return true;
  }
}
