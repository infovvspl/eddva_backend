import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditLogService } from './audit-log.service';
import { AUDIT_METADATA_KEY, AuditMetadata } from './audit.decorator';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.reflector.get<AuditMetadata>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const ipAddress =
      request.ip ||
      request.headers['x-forwarded-for'] ||
      request.connection?.remoteAddress ||
      null;

    const formattedIp =
      typeof ipAddress === 'string' && ipAddress.includes(',')
        ? ipAddress.split(',')[0].trim()
        : ipAddress;

    // Strip the global API prefix (e.g. /api/v1/) before matching route patterns
    const rawUrl: string = request.url || '';
    const routePath = rawUrl.replace(/^\/api\/v\d+\//, '').replace(/^\//, '');
    // School routes start with 'school/' — all other routes belong to the coaching vertical
    const isSchool = routePath.startsWith('school/');
    const isCoaching = !isSchool && (routePath.startsWith('super-admin') || routePath.startsWith('admin') || routePath.startsWith('auth') || routePath.startsWith('tenants'));
    const connection = isCoaching ? 'coaching' : 'school';

    return next.handle().pipe(
      tap((response) => {
        // Successful execution
        let userId = request.user?.id || null;
        let userName = request.user?.fullName || request.user?.name || request.user?.email || null;
        let role = request.user?.role || null;
        let instituteId = request.user?.instituteId || null;

        // Special case for login: extract user info from response if not present in request.user
        if (!userId && response && response.user) {
          userId = response.user.id;
          userName = response.user.fullName || response.user.name || response.user.email;
          role = response.user.role;
          instituteId = response.user.instituteId || null;
        }

        // construct description
        let description = metadata.description || `${metadata.action} action performed on ${metadata.module}`;
        description = this.interpolateDescription(description, request, response);

        this.auditLogService.log(
          userId,
          userName,
          role,
          metadata.module,
          metadata.action,
          description,
          formattedIp,
          'Success',
          instituteId,
          connection,
        ).catch(() => {});
      }),
      catchError((err) => {
        // Failed execution
        const userId = request.user?.id || null;
        const userName = request.user?.fullName || request.user?.name || request.user?.email || null;
        const role = request.user?.role || null;
        const instituteId = request.user?.instituteId || null;

        let description = metadata.description || `${metadata.action} action performed on ${metadata.module}`;
        description = this.interpolateDescription(description, request, null);
        description += ` - Failed: ${err.message || err}`;

        this.auditLogService.log(
          userId,
          userName,
          role,
          metadata.module,
          metadata.action,
          description,
          formattedIp,
          'Failure',
          instituteId,
          connection,
        ).catch(() => {});

        return throwError(() => err);
      }),
    );
  }

  private interpolateDescription(
    description: string,
    request: any,
    response: any,
  ): string {
    return description.replace(/\{([^}]+)\}/g, (match, path) => {
      const parts = path.split('.');
      let obj: any = null;
      if (parts[0] === 'body') obj = request.body;
      else if (parts[0] === 'params') obj = request.params;
      else if (parts[0] === 'query') obj = request.query;
      else if (parts[0] === 'user') obj = request.user;
      else if (parts[0] === 'response') obj = response;

      if (!obj) return match;

      let val = obj;
      for (let i = 1; i < parts.length; i++) {
        val = val?.[parts[i]];
      }
      return val !== undefined && val !== null ? String(val) : match;
    });
  }
}
