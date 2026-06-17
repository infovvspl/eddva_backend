import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Feature flag + per-institute quota management using raw SQL.
// Creates its own table on startup (same pattern as AiUsageService).
// institute_id = '' (empty string) for global-scope flags.

@Injectable()
export class AiFeatureFlagService implements OnModuleInit {
  private readonly logger = new Logger(AiFeatureFlagService.name);
  private ready = false;

  constructor(
    @InjectDataSource('coaching') private readonly coachingDs: DataSource,
    @InjectDataSource('school') private readonly schoolDs: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTables();
  }

  private async ensureTables() {
    if (this.ready) return;
    const sql = `
      CREATE TABLE IF NOT EXISTS ai_feature_flags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        feature_id VARCHAR(64) NOT NULL,
        scope VARCHAR(16) NOT NULL DEFAULT 'global',
        institute_id VARCHAR(64) NOT NULL DEFAULT '',
        is_enabled BOOLEAN NOT NULL DEFAULT true,
        monthly_request_limit INT NULL,
        monthly_cost_cap NUMERIC(10,2) NULL,
        updated_by VARCHAR(128) NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_ai_feature_flags UNIQUE (feature_id, scope, institute_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_flags_feature ON ai_feature_flags(feature_id);
    `;
    await Promise.all([
      this.coachingDs.query(sql),
      this.schoolDs.query(sql),
    ]);
    this.ready = true;
  }

  private getDs(instituteType: 'school' | 'coaching'): DataSource {
    return instituteType === 'school' ? this.schoolDs : this.coachingDs;
  }

  async isFeatureEnabled(
    instituteId: string,
    instituteType: 'school' | 'coaching',
    featureId: string,
  ): Promise<boolean> {
    try {
      await this.ensureTables();
      const rows: Array<{ is_enabled: boolean }> = await this.getDs(instituteType).query(
        `SELECT is_enabled FROM ai_feature_flags
         WHERE feature_id=$1
           AND (scope='global' OR (scope='institute' AND institute_id=$2))
         ORDER BY (scope='institute') DESC
         LIMIT 1`,
        [featureId, instituteId ?? ''],
      );
      return rows.length ? rows[0].is_enabled : true;
    } catch (err: unknown) {
      this.logger.warn(`Feature flag check failed (defaulting to enabled): ${err}`);
      return true; // never block AI on infrastructure failure
    }
  }

  async checkQuota(
    instituteId: string,
    instituteType: 'school' | 'coaching',
    featureId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      await this.ensureTables();
      const ds = this.getDs(instituteType);
      const rows: Array<{ monthly_request_limit: number | null; monthly_cost_cap: string | null }> =
        await ds.query(
          `SELECT monthly_request_limit, monthly_cost_cap FROM ai_feature_flags
           WHERE feature_id=$1 AND scope='institute' AND institute_id=$2 LIMIT 1`,
          [featureId, instituteId ?? ''],
        );
      if (!rows.length || (!rows[0].monthly_request_limit && !rows[0].monthly_cost_cap)) {
        return { allowed: true };
      }
      const { monthly_request_limit, monthly_cost_cap } = rows[0];

      const usageRows: Array<{ count: string; cost: string }> = await ds.query(
        `SELECT COALESCE(SUM(request_count),0)::int AS count,
                COALESCE(SUM(est_cost),0)::numeric AS cost
         FROM ai_usage_daily
         WHERE institute_id=$1 AND feature=$2
           AND day >= date_trunc('month', CURRENT_DATE)`,
        [instituteId, featureId],
      );
      const count = parseInt(usageRows[0]?.count ?? '0', 10);
      const cost = parseFloat(usageRows[0]?.cost ?? '0');

      if (monthly_request_limit && count >= Number(monthly_request_limit)) {
        return { allowed: false, reason: 'Monthly request limit reached' };
      }
      if (monthly_cost_cap && cost >= Number(monthly_cost_cap)) {
        return { allowed: false, reason: 'Monthly cost cap reached' };
      }
      return { allowed: true };
    } catch (err: unknown) {
      this.logger.warn(`Quota check failed (defaulting to allowed): ${err}`);
      return { allowed: true };
    }
  }

  async setFeatureFlag(dto: {
    featureId: string;
    scope: 'global' | 'institute';
    instituteId?: string;
    instituteType: 'school' | 'coaching';
    isEnabled: boolean;
    monthlyRequestLimit?: number;
    monthlyCostCap?: number;
    updatedBy: string;
  }): Promise<{ success: boolean }> {
    await this.ensureTables();
    const instId = dto.scope === 'institute' ? (dto.instituteId ?? '') : '';
    await this.getDs(dto.instituteType).query(
      `INSERT INTO ai_feature_flags
         (feature_id, scope, institute_id, is_enabled, monthly_request_limit, monthly_cost_cap, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT ON CONSTRAINT uq_ai_feature_flags DO UPDATE SET
         is_enabled            = EXCLUDED.is_enabled,
         monthly_request_limit = COALESCE(EXCLUDED.monthly_request_limit, ai_feature_flags.monthly_request_limit),
         monthly_cost_cap      = COALESCE(EXCLUDED.monthly_cost_cap, ai_feature_flags.monthly_cost_cap),
         updated_by            = EXCLUDED.updated_by,
         updated_at            = NOW()`,
      [
        dto.featureId,
        dto.scope,
        instId,
        dto.isEnabled,
        dto.monthlyRequestLimit ?? null,
        dto.monthlyCostCap ?? null,
        dto.updatedBy,
      ],
    );
    return { success: true };
  }

  async getGlobalFlags(product: 'school' | 'coaching' | 'all'): Promise<Record<string, boolean>> {
    await this.ensureTables();
    const result: Record<string, boolean> = {};
    const fetch = async (ds: DataSource) => {
      const rows: Array<{ feature_id: string; is_enabled: boolean }> = await ds.query(
        `SELECT feature_id, is_enabled FROM ai_feature_flags WHERE scope='global'`,
      );
      for (const r of rows) result[r.feature_id] = r.is_enabled;
    };
    if (product === 'coaching' || product === 'all') await fetch(this.coachingDs);
    if (product === 'school' || product === 'all') await fetch(this.schoolDs);
    return result;
  }
}
