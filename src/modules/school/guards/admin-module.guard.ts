import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_MODULE_KEY } from '../decorators/require-admin-module.decorator';
import { hasSchoolRole } from '../common/role-helper';

@Injectable()
export class AdminModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredModule = this.reflector.getAllAndOverride<string>(ADMIN_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredModule) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('User authorization failed');

    if (hasSchoolRole(user.role, 'SUPER_ADMIN')) return true;
    // This guard only scopes INSTITUTE_ADMIN access — routes shared with other
    // roles (e.g. a TEACHER-accessible endpoint on the same controller) are
    // untouched for those roles.
    if (!hasSchoolRole(user.role, 'INSTITUTE_ADMIN')) return true;
    if (user.isPrimaryAdmin) return true;

    const granted = Array.isArray(user.adminPermissions) ? user.adminPermissions : [];
    if (!granted.includes(requiredModule)) {
      throw new ForbiddenException(`You do not have access to the "${requiredModule}" module`);
    }
    return true;
  }
}
