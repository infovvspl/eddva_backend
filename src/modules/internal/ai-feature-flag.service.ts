import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Feature flag + per-institute quota management using raw SQL.
// Creates its own table on startup (same pattern as AiUsageService).
// institute_id = '' (empty string) for global-scope flags.

interface FlagRow {
  feature_id: string;
  scope: string;
  is_enabled: boolean;
  monthly_request_limit: number | null;
  monthly_cost_cap: string | null;
}

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

  /** Flag rows are read on every AI call, so they are kept for a few seconds; any change made here drops them at once. */
  private readonly flagCache = new Map<string, { exp: number; rows: FlagRow[] }>();
  private static readonly FLAG_TTL_MS = 15_000;

  /** The platform-wide rows and this institute's own rows, in one query. */
  private async flagRows(instituteId: string, instituteType: 'school' | 'coaching'): Promise<FlagRow[]> {
    const key = `${instituteType}:${instituteId ?? ''}`;
    const hit = this.flagCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.rows;
    await this.ensureTables();
    const rows: FlagRow[] = await this.getDs(instituteType).query(
      `SELECT feature_id, scope, is_enabled, monthly_request_limit, monthly_cost_cap
         FROM ai_feature_flags
        WHERE scope = 'global' OR (scope = 'institute' AND institute_id = $1)`,
      [instituteId ?? ''],
    );
    this.flagCache.set(key, { exp: Date.now() + AiFeatureFlagService.FLAG_TTL_MS, rows });
    return rows;
  }

  /** On unless this institute's own setting, or else the platform-wide one, says off. Never blocks on a failed lookup. */
  async isFeatureEnabled(
    instituteId: string,
    instituteType: 'school' | 'coaching',
    featureId: string,
  ): Promise<boolean> {
    try {
      const rows = (await this.flagRows(instituteId, instituteType)).filter((r) => r.feature_id === featureId);
      const own = rows.find((r) => r.scope === 'institute');
      const global = rows.find((r) => r.scope === 'global');
      return (own ?? global)?.is_enabled ?? true;
    } catch (err: unknown) {
      this.logger.warn(`Feature flag check failed (defaulting to enabled): ${err}`);
      return true; // never block AI on infrastructure failure
    }
  }

  /** Whether this institute has used up the monthly request limit or cost cap set for the feature. */
  async checkQuota(
    instituteId: string,
    instituteType: 'school' | 'coaching',
    featureId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const own = (await this.flagRows(instituteId, instituteType)).find((r) => r.feature_id === featureId && r.scope === 'institute');
      const limit = own?.monthly_request_limit ? Number(own.monthly_request_limit) : null;
      const cap = own?.monthly_cost_cap ? Number(own.monthly_cost_cap) : null;
      if (!limit && !cap) return { allowed: true };

      const usageRows: Array<{ count: string; cost: string }> = await this.getDs(instituteType).query(
        `SELECT COALESCE(SUM(request_count),0)::int AS count,
                COALESCE(SUM(est_cost),0)::numeric AS cost
           FROM ai_usage_daily
          WHERE institute_id=$1 AND feature=$2
            AND day >= date_trunc('month', CURRENT_DATE)`,
        [instituteId, featureId],
      );
      const count = parseInt(usageRows[0]?.count ?? '0', 10);
      const cost = parseFloat(usageRows[0]?.cost ?? '0');
      if (limit && count >= limit) return { allowed: false, reason: `the monthly limit of ${limit} requests has been reached` };
      if (cap && cost >= cap) return { allowed: false, reason: `the monthly cost cap of $${cap} has been reached` };
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
    /** Remove the limit or cap instead of keeping what is there. */
    clearRequestLimit?: boolean;
    clearCostCap?: boolean;
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
         monthly_request_limit = CASE WHEN $8 THEN NULL ELSE COALESCE(EXCLUDED.monthly_request_limit, ai_feature_flags.monthly_request_limit) END,
         monthly_cost_cap      = CASE WHEN $9 THEN NULL ELSE COALESCE(EXCLUDED.monthly_cost_cap, ai_feature_flags.monthly_cost_cap) END,
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
        dto.clearRequestLimit === true,
        dto.clearCostCap === true,
      ],
    );
    this.flagCache.clear();
    return { success: true };
  }

  /** Fetch all flags relevant to a specific institute in one query.
   *  Returns a map of featureId → { isEnabled, monthlyLimit }.
   *  Institute-specific rows take precedence over global rows. */
  async getInstituteFlags(
    instituteId: string,
    instituteType: 'school' | 'coaching',
  ): Promise<Record<string, { isEnabled: boolean; monthlyLimit: number | null; monthlyCostCap: number | null }>> {
    await this.ensureTables();
    const ds = this.getDs(instituteType);
    const rows: Array<{
      feature_id: string;
      scope: string;
      is_enabled: boolean;
      monthly_request_limit: number | null;
      monthly_cost_cap: string | null;
    }> = await ds.query(
      `SELECT feature_id, scope, is_enabled, monthly_request_limit, monthly_cost_cap
       FROM ai_feature_flags
       WHERE scope = 'global' OR (scope = 'institute' AND institute_id = $1)
       ORDER BY (scope = 'institute') DESC`,
      [instituteId ?? ''],
    );
    const result: Record<string, { isEnabled: boolean; monthlyLimit: number | null; monthlyCostCap: number | null }> = {};
    // Rows ordered: institute first → first-write-wins gives institute precedence over global
    for (const r of rows) {
      if (!(r.feature_id in result)) {
        result[r.feature_id] = {
          isEnabled: r.is_enabled,
          monthlyLimit: r.monthly_request_limit ?? null,
          monthlyCostCap: r.monthly_cost_cap == null ? null : Number(r.monthly_cost_cap),
        };
      }
    }
    return result;
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
