import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class TenantAiFeatureService {
  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Returns true if the tenant has the given AI feature enabled.
   * Cached 5min in CACHE_MANAGER under the same key the AiFeatureGuard uses,
   * so toggling a tenant's AI config invalidates both at once.
   */
  async checkFeature(tenantId: string, feature: string): Promise<boolean> {
    if (!tenantId) return false;
    const cacheKey = `tenant_ai:${tenantId}`;
    let cfg = await this.cacheManager.get<{ aiEnabled: boolean; aiFeatures: string[] }>(cacheKey);
    
    if (!cfg) {
      const rows: any[] = await this.dataSource.query(
        `SELECT ai_enabled, ai_features FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId],
      );
      cfg = {
        aiEnabled: false,
        aiFeatures: [],
      };
      if (rows && rows.length > 0) {
        cfg.aiEnabled = !!rows[0].ai_enabled;
        if (typeof rows[0].ai_features === 'string') {
          try {
            cfg.aiFeatures = JSON.parse(rows[0].ai_features);
          } catch {
            cfg.aiFeatures = [];
          }
        } else if (Array.isArray(rows[0].ai_features)) {
          cfg.aiFeatures = rows[0].ai_features;
        }
      }
      await this.cacheManager.set(cacheKey, cfg, 300000); // 5 mins in ms
    }

    if (!cfg.aiEnabled) return false;
    return cfg.aiFeatures.includes(feature);
  }
}
