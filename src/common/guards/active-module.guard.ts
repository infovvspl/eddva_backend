import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ACTIVE_MODULES_KEY = 'activeModules';
export const RequireModule = (...modules: string[]) => SetMetadata(ACTIVE_MODULES_KEY, modules);

@Injectable()
export class ActiveModuleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredModules = this.reflector.getAllAndOverride<string[]>(
      ACTIVE_MODULES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredModules || requiredModules.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // Super Admins can bypass this guard
    if (user?.role === 'super_admin') {
      return true;
    }

    const tenantActiveModules: string[] = typeof user?.inst_active_modules === 'string' 
      ? JSON.parse(user.inst_active_modules) 
      : (user?.inst_active_modules ?? []);

    const hasAccess = requiredModules.some((mod) => tenantActiveModules.includes(mod));
    if (!hasAccess) {
      throw new ForbiddenException(`Access denied. School does not have the '${requiredModules.join(', ')}' module enabled.`);
    }

    return true;
  }
}
