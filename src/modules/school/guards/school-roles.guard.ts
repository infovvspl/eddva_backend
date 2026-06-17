import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCHOOL_ROLES_KEY } from '../decorators/school-roles.decorator';

@Injectable()
export class SchoolRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(SCHOOL_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('User authorization failed');
    const userRole = String(user.role || '').toUpperCase();
    const allowedRoles = roles.map((role) => String(role).toUpperCase());
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException(`Role '${user.role}' is not authorized to access this resource`);
    }
    return true;
  }
}
