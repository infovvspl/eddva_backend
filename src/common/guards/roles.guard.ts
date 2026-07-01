import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../database/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role restriction — pass through
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('No user in request');
    }

    const userRole = String(user.role || '').toUpperCase();
    const tenant = user.tenant;

    if (tenant) {
      if (userRole === 'INSTITUTE_ADMIN' && tenant.adminPortalEnabled === false) {
        throw new ForbiddenException('Admin portal is disabled for this institute');
      }
      if (userRole === 'TEACHER' && tenant.teacherPortalEnabled === false) {
        throw new ForbiddenException('Teacher portal is disabled for this institute');
      }
      if (userRole === 'STUDENT' && tenant.studentPortalEnabled === false) {
        throw new ForbiddenException('Student portal is disabled for this institute');
      }
      if (userRole === 'PARENT' && tenant.parentPortalEnabled === false) {
        throw new ForbiddenException('Parent portal is disabled for this institute');
      }
    }

    const teacherPortalEnabled = tenant ? tenant.teacherPortalEnabled !== false : true;

    let hasRole = requiredRoles.some(
      (role) => String(role).toUpperCase() === userRole,
    );

    // If requiredRoles contains UserRole.TEACHER and we are STAFF_BASED (teacherPortalEnabled is false),
    // allow institute_admin users who are:
    // 1. DIRECTOR or ACADEMIC_COORDINATOR (or primary admin, where permissionGroup is null/undefined)
    // 2. Or who have a customRole with any academic/teaching permission
    if (!hasRole && requiredRoles.includes(UserRole.TEACHER) && user.role === UserRole.INSTITUTE_ADMIN && !teacherPortalEnabled) {
      const allowedGroups = ['DIRECTOR', 'ACADEMIC_COORDINATOR'];
      const hasLegacyPermission = !user.permissionGroup || allowedGroups.includes(String(user.permissionGroup).toUpperCase());
      
      const academicPermissions = ['batches', 'content', 'mock_tests', 'lectures', 'doubts', 'quizzes', 'analytics', 'calendar'];
      const userPermissions = user.customRole?.permissions || [];
      const hasDynamicPermission = Array.isArray(userPermissions) && userPermissions.some(p => academicPermissions.includes(p));

      if (hasLegacyPermission || hasDynamicPermission) {
        hasRole = true;
      }
    }

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required: [${requiredRoles.join(', ')}]. Your role: ${user.role}`,
      );
    }

    return true;

  }
}
