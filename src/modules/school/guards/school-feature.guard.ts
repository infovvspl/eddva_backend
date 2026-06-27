import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SCHOOL_FEATURE_KEY, SchoolFeatureRequirement } from '../decorators/school-feature.decorator';

@Injectable()
export class SchoolFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<SchoolFeatureRequirement>(SCHOOL_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requirement) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException({ code: 'NO_USER', message: 'User not resolved' });
    }

    if (user.role === 'SUPER_ADMIN') {
      return true;
    }

    if (requirement.type === 'module') {
      const modules = user.inst_modules_permissions || {};
      if (modules[requirement.key] === false) {
        throw new ForbiddenException({
          code: 'FEATURE_DISABLED',
          feature: requirement.key,
          message: `The module "${requirement.key}" is disabled for your institution.`,
        });
      }
    } else if (requirement.type === 'ai') {
      if (!user.inst_ai_enabled) {
        throw new ForbiddenException({
          code: 'AI_NOT_ENABLED',
          message: 'AI features are disabled for your institution.',
        });
      }
      
      const aiFeatures = user.inst_ai_features || {};
      if (aiFeatures[requirement.key] === false) {
        throw new ForbiddenException({
          code: 'FEATURE_DISABLED',
          feature: requirement.key,
          message: `The AI feature "${requirement.key}" is disabled for your institution.`,
        });
      }
    }

    return true;
  }
}
