import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isSchoolAiFeatureEnabled } from '../common/ai-features.registry';
import { hasSchoolRole } from '../common/role-helper';

/**
 * Gates every Institute Admin / Teacher / Student endpoint in the
 * competitive vertical behind the institute's `competitive_exams` AI
 * feature — this vertical's whole value is AI generation/extraction, so it
 * belongs in the AI-feature registry (gated by `aiEnabled` + per-key
 * `aiFeatures`) rather than the generic always-on module-flag system.
 *
 * Reuses `isSchoolAiFeatureEnabled`, the same resolution `SchoolFeatureGuard`
 * uses for `@SchoolFeature('ai', key)` — registered with `defaultEnabled:
 * false` in ai-features.registry.ts, so a missing key correctly reads as
 * disabled, not the fail-open default most legacy AI features there use.
 */
@Injectable()
export class CompetitiveFeatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException({ code: 'NO_USER', message: 'User not resolved' });
    }

    if (hasSchoolRole(user.role, 'SUPER_ADMIN')) {
      return true;
    }

    if (!isSchoolAiFeatureEnabled(user, 'competitive_exams')) {
      throw new ForbiddenException({
        code: 'FEATURE_DISABLED',
        feature: 'competitive_exams',
        message: 'Competitive Exam Prep is not enabled for your institution.',
      });
    }

    return true;
  }
}
