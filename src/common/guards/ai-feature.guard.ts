import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, AiFeatureKey } from '../../database/entities/tenant.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

export const AI_FEATURE_KEY = 'ai_feature';
export const AI_FEATURE_CACHE_TTL = 300_000; // 5 minutes in ms

@Injectable()
export class AiFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Tenant, 'coaching')
    private readonly tenantRepo: Repository<Tenant>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<AiFeatureKey>(AI_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No feature requirement = pass through
    if (!requiredFeature) return true;

    const req = context.switchToHttp().getRequest();
    // Match @TenantId() decorator resolution: JWT tenant first, middleware fallback
    const tenantId: string | undefined = req.user?.tenantId || req.tenantId;

    // Platform super admin always bypasses feature gates
    if (req.user?.role === 'super_admin') return true;

    if (!tenantId) {
      throw new ForbiddenException({ code: 'NO_TENANT', message: 'Tenant not resolved' });
    }

    const features = await this.getTenantFeatures(tenantId);

    if (!features.aiEnabled) {
      throw new ForbiddenException({
        code: 'AI_NOT_ENABLED',
        message: 'AI features are not enabled for your institution.',
      });
    }

    if (!features.aiFeatures.includes(requiredFeature)) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_ENABLED',
        feature: requiredFeature,
        message: `The feature "${requiredFeature}" is not enabled for your institution.`,
      });
    }

    return true;
  }

  private async getTenantFeatures(tenantId: string): Promise<{ aiEnabled: boolean; aiFeatures: AiFeatureKey[] }> {
    const cacheKey = `tenant_ai:${tenantId}`;
    const cached = await this.cache.get<{ aiEnabled: boolean; aiFeatures: AiFeatureKey[] }>(cacheKey);
    if (cached) return cached;

    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['id', 'aiEnabled', 'aiFeatures'],
    });

    const result = {
      aiEnabled: tenant?.aiEnabled ?? false,
      aiFeatures: tenant?.aiFeatures ?? [],
    };

    await this.cache.set(cacheKey, result, AI_FEATURE_CACHE_TTL);
    return result;
  }
}
