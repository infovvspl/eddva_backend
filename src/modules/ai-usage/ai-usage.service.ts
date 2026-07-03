import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Per-institute, per-feature AI usage tracking + quota enforcement.
 *
 * Every AI call funnels through AiBridgeService.post(), which calls record()
 * here (fire-and-forget). We persist a raw event and upsert a daily rollup so
 * dashboards and quota checks are cheap. Quotas are optional per institute.
 */

export interface AiUsageEvent {
  instituteId?: string | null;
  vertical?: string | null;
  feature: string;
  provider?: string | null;
  model?: string | null;
  success: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  units?: number | null;       // provider-specific: audio seconds / chars
  unitType?: string | null;    // 'tokens' | 'audio_seconds' | 'chars' | 'request'
  estCost?: number | null;
}

@Injectable()
export class AiUsageService implements OnModuleInit {
  private readonly logger = new Logger(AiUsageService.name);
  private ready = false;
  // Short-lived cache so quota checks don't add a DB round-trip to every AI call.
  private quotaCache = new Map<string, { allowed: boolean; used: number; limit: number; exp: number }>();
  private readonly QUOTA_TTL_MS = 60_000;

  // Accurate cost rates (USD). Token-based for LLMs; flat per-request
  // for audio/char features where token counts aren't returned.
  private static readonly INPUT_RATE_PER_1K: Record<string, number> = {
    groq: 0.00005, groq_gemini: 0.000075, gemini: 0.000075, groq_vision: 0.00005, whisper_llm: 0.00005,
  };
  private static readonly OUTPUT_RATE_PER_1K: Record<string, number> = {
    groq: 0.00008, groq_gemini: 0.000300, gemini: 0.000300, groq_vision: 0.00008, whisper_llm: 0.00008,
  };
  private static readonly REQUEST_RATE: Record<string, number> = {
    whisper_sarvam: 0.02, whisper_llm: 0.02, sarvam: 0.001, groq_vision: 0.001,
  };

  constructor(
    @InjectDataSource('coaching') private readonly ds: DataSource,
    @InjectDataSource('school') private readonly schoolDs: DataSource,
  ) {}

  private estimateCost(
    provider: string | null | undefined, 
    totalTokens: number | null | undefined,
    promptTokens?: number | null,
    completionTokens?: number | null,
  ): number {
    const p = provider || 'groq';
    
    // Accurate calculation based on input/output splits
    if (promptTokens !== null && promptTokens !== undefined && completionTokens !== null && completionTokens !== undefined) {
      const inRate = AiUsageService.INPUT_RATE_PER_1K[p] || 0.00005;
      const outRate = AiUsageService.OUTPUT_RATE_PER_1K[p] || 0.00008;
      const cost = ((promptTokens / 1000) * inRate) + ((completionTokens / 1000) * outRate);
      if (cost > 0) return +cost.toFixed(6);
    }

    // Fallback if only totalTokens are available (rough average rate)
    if (totalTokens && AiUsageService.INPUT_RATE_PER_1K[p]) {
      const avgRate = (AiUsageService.INPUT_RATE_PER_1K[p] + AiUsageService.OUTPUT_RATE_PER_1K[p]) / 2;
      return +((totalTokens / 1000) * avgRate).toFixed(6);
    }
    if (AiUsageService.REQUEST_RATE[p]) return AiUsageService.REQUEST_RATE[p];
    if (totalTokens) return +((totalTokens / 1000) * 0.000065).toFixed(6);
    return 0.0005;
  }

  async onModuleInit() {
    await this.ensureTables();
  }

  private async ensureTables() {
    if (this.ready) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NULL,
        vertical VARCHAR(16) NULL,
        feature VARCHAR(48) NOT NULL,
        provider VARCHAR(24) NULL,
        model VARCHAR(80) NULL,
        success BOOLEAN NOT NULL DEFAULT true,
        status_code INT NULL,
        latency_ms INT NULL,
        prompt_tokens INT NULL,
        completion_tokens INT NULL,
        total_tokens INT NULL,
        units NUMERIC(14,2) NULL,
        unit_type VARCHAR(16) NULL,
        est_cost NUMERIC(14,6) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_events_inst_time ON ai_usage_events(institute_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_events_feat_time ON ai_usage_events(feature, created_at);

      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        institute_id UUID NOT NULL,
        vertical VARCHAR(16) NOT NULL DEFAULT 'coaching',
        feature VARCHAR(48) NOT NULL,
        day DATE NOT NULL,
        request_count INT NOT NULL DEFAULT 0,
        success_count INT NOT NULL DEFAULT 0,
        error_count INT NOT NULL DEFAULT 0,
        total_latency_ms BIGINT NOT NULL DEFAULT 0,
        total_tokens BIGINT NOT NULL DEFAULT 0,
        est_cost NUMERIC(16,6) NOT NULL DEFAULT 0,
        last_call_at TIMESTAMPTZ NULL,
        PRIMARY KEY (institute_id, vertical, feature, day)
      );
      ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS success_count INT NOT NULL DEFAULT 0;
      ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS error_count INT NOT NULL DEFAULT 0;
      ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS total_latency_ms BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE ai_usage_daily ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ NULL;

      CREATE TABLE IF NOT EXISTS ai_usage_quotas (
        institute_id UUID NOT NULL,
        vertical VARCHAR(16) NOT NULL DEFAULT 'coaching',
        feature VARCHAR(48) NOT NULL DEFAULT '*',
        monthly_limit INT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (institute_id, vertical, feature)
      );
    `);
    this.ready = true;
  }

  /** Persist a usage event + upsert the daily rollup. Best-effort; never throws. */
  async record(ev: AiUsageEvent): Promise<void> {
    try {
      await this.ensureTables();
      // Estimate cost when the caller didn't provide one (only for successful calls).
      if ((ev.estCost === undefined || ev.estCost === null) && ev.success) {
        ev.estCost = this.estimateCost(ev.provider, ev.totalTokens, ev.promptTokens, ev.completionTokens);
      }

      // Compute totalTokens from prompt+completion if not provided directly
      if ((ev.totalTokens === undefined || ev.totalTokens === null) && ev.promptTokens != null && ev.completionTokens != null) {
        ev.totalTokens = ev.promptTokens + ev.completionTokens;
      }

      this.logger.debug(
        `[record] feature=${ev.feature} vertical=${ev.vertical} institute=${ev.instituteId} ` +
        `tokens=${ev.totalTokens}(prompt=${ev.promptTokens},completion=${ev.completionTokens}) cost=${ev.estCost}`,
      );

      await this.ds.query(
        `INSERT INTO ai_usage_events
           (institute_id, vertical, feature, provider, model, success, status_code,
            latency_ms, prompt_tokens, completion_tokens, total_tokens, units, unit_type, est_cost)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          ev.instituteId || null,
          ev.vertical || null,
          ev.feature,
          ev.provider || null,
          ev.model || null,
          ev.success,
          ev.statusCode ?? null,
          ev.latencyMs ?? null,
          ev.promptTokens ?? null,
          ev.completionTokens ?? null,
          ev.totalTokens ?? null,
          ev.units ?? null,
          ev.unitType || null,
          ev.estCost ?? null,
        ],
      );

      // Daily rollup (only when we know the institute — quota/dashboards are per-institute).\
      if (ev.instituteId) {
        await this.ds.query(
          `INSERT INTO ai_usage_daily
             (institute_id, vertical, feature, day, request_count, success_count, error_count, total_latency_ms, total_tokens, est_cost, last_call_at)
           VALUES ($1,$2,$3,CURRENT_DATE,1,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (institute_id, vertical, feature, day) DO UPDATE SET
             request_count = ai_usage_daily.request_count + 1,
             success_count = ai_usage_daily.success_count + $4,
             error_count   = ai_usage_daily.error_count + $5,
             total_latency_ms = ai_usage_daily.total_latency_ms + $6,
             total_tokens  = ai_usage_daily.total_tokens + $7,
             est_cost      = ai_usage_daily.est_cost + $8,
             last_call_at  = NOW()`,
          [
            ev.instituteId,
            ev.vertical || 'coaching',
            ev.feature,
            ev.success ? 1 : 0,
            ev.success ? 0 : 1,
            ev.latencyMs ?? 0,
            ev.totalTokens ?? 0,
            ev.estCost ?? 0,
          ],
        );
        this.logger.debug(`[record] daily upsert done — tokens=${ev.totalTokens ?? 0} cost=${ev.estCost ?? 0}`);
        // Invalidate quota cache for this institute/feature so the next check is fresh.
        this.quotaCache.delete(`${ev.instituteId}:${ev.vertical || 'coaching'}:${ev.feature}`);
      }
    } catch (err: any) {
      this.logger.warn(`AI usage record failed: ${err?.message}`);
    }
  }

  /**
   * Check whether an institute may use a feature this month.
   * Returns { allowed: true } when no quota is configured (default open).
   */
  async checkQuota(
    instituteId: string | undefined | null,
    vertical: string | undefined | null,
    feature: string,
  ): Promise<{ allowed: boolean; used: number; limit: number | null; remaining: number | null }> {
    if (!instituteId) return { allowed: true, used: 0, limit: null, remaining: null };
    const v = vertical || 'coaching';
    const key = `${instituteId}:${v}:${feature}`;
    const cached = this.quotaCache.get(key);
    if (cached && cached.exp > Date.now()) {
      return { allowed: cached.allowed, used: cached.used, limit: cached.limit, remaining: Math.max(0, cached.limit - cached.used) };
    }
    try {
      await this.ensureTables();
      // Most specific quota wins: exact feature, else wildcard '*'.
      const qrows = await this.ds.query(
        `SELECT feature, monthly_limit FROM ai_usage_quotas
         WHERE institute_id=$1 AND vertical=$2 AND feature IN ($3, '*')
         ORDER BY (feature = $3) DESC LIMIT 1`,
        [instituteId, v, feature],
      );
      if (!qrows.length) return { allowed: true, used: 0, limit: null, remaining: null };
      const limit = Number(qrows[0].monthly_limit);
      const scope = qrows[0].feature; // '*' or the exact feature
      // Current-month usage (for '*' quota, sum all features).
      const used = Number(
        (await this.ds.query(
          `SELECT COALESCE(SUM(request_count),0) AS used FROM ai_usage_daily
           WHERE institute_id=$1 AND vertical=$2
             AND ($3 = '*' OR feature = $3)
             AND day >= date_trunc('month', CURRENT_DATE)`,
          [instituteId, v, scope],
        ))[0].used,
      );
      const allowed = used < limit;
      this.quotaCache.set(key, { allowed, used, limit, exp: Date.now() + this.QUOTA_TTL_MS });
      return { allowed, used, limit, remaining: Math.max(0, limit - used) };
    } catch (err: any) {
      this.logger.warn(`Quota check failed (allowing): ${err?.message}`);
      return { allowed: true, used: 0, limit: null, remaining: null };
    }
  }

  // ── Read / dashboard queries ───────────────────────────────────────────────

  /** Raw row-by-row event logs for deep auditing */
  async getRawLogs(opts: { instituteId?: string; vertical?: string; feature?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    let sql = ` WHERE 1=1`;
    if (opts.from) sql += ` AND created_at >= $${params.push(opts.from + ' 00:00:00')}`;
    if (opts.to) sql += ` AND created_at <= $${params.push(opts.to + ' 23:59:59')}`;
    if (opts.instituteId) sql += ` AND institute_id = $${params.push(opts.instituteId)}`;
    if (opts.vertical) sql += ` AND vertical = $${params.push(opts.vertical)}`;
    if (opts.feature) sql += ` AND feature = $${params.push(opts.feature)}`;
    
    const limit = opts.limit ? Math.min(Number(opts.limit), 500) : 100;
    const offset = opts.offset ? Number(opts.offset) : 0;
    
    const countRes = await this.ds.query(`SELECT COUNT(*)::int AS total FROM ai_usage_events${sql}`, params);
    
    sql += ` ORDER BY created_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`;
    const rows = await this.ds.query(`
      SELECT id, institute_id, vertical, feature, provider, model, success, status_code, latency_ms, 
             prompt_tokens, completion_tokens, total_tokens, est_cost, created_at
      FROM ai_usage_events${sql}
    `, params);
    
    return {
      data: rows,
      total: countRes[0]?.total || 0,
      limit,
      offset
    };
  }

  private monthStart(from?: string): string {
    return from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  }

  private filterSql(opts: { instituteId?: string; vertical?: string; from?: string; to?: string }, params: any[]): string {
    let sql = ` WHERE day >= $${params.push(this.monthStart(opts.from))}`;
    if (opts.to) sql += ` AND day <= $${params.push(opts.to)}`;
    if (opts.instituteId) sql += ` AND institute_id = $${params.push(opts.instituteId)}`;
    if (opts.vertical) sql += ` AND vertical = $${params.push(opts.vertical)}`;
    return sql;
  }

  /** Platform/institute totals for the period. */
  async getOverview(opts: { instituteId?: string; vertical?: string; from?: string; to?: string } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    const where = this.filterSql(opts, params);
    const rows = await this.ds.query(
      `SELECT COALESCE(SUM(request_count),0)::int AS requests,
              COALESCE(SUM(success_count),0)::int AS success,
              COALESCE(SUM(error_count),0)::int AS errors,
              COALESCE(SUM(total_tokens),0)::bigint AS tokens,
              COALESCE(SUM(est_cost),0)::numeric AS cost,
              CASE WHEN SUM(request_count) > 0 THEN ROUND(SUM(total_latency_ms)::numeric / SUM(request_count)) ELSE 0 END AS avg_latency_ms,
              COUNT(DISTINCT institute_id)::int AS institutes
       FROM ai_usage_daily${where}`,
      params,
    );
    return rows[0];
  }

  async getByFeature(opts: { instituteId?: string; vertical?: string; from?: string; to?: string } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    const where = this.filterSql(opts, params);
    return this.ds.query(
      `SELECT feature,
              SUM(request_count)::int AS requests,
              SUM(success_count)::int AS success,
              SUM(error_count)::int AS errors,
              SUM(total_tokens)::bigint AS tokens,
              SUM(est_cost)::numeric AS cost,
              CASE WHEN SUM(request_count) > 0 THEN ROUND(SUM(total_latency_ms)::numeric / SUM(request_count)) ELSE 0 END AS avg_latency_ms
       FROM ai_usage_daily${where}
       GROUP BY feature ORDER BY requests DESC`,
      params,
    );
  }

  async getTrend(opts: { instituteId?: string; vertical?: string; from?: string; to?: string } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    const where = this.filterSql(opts, params);
    return this.ds.query(
      `SELECT TO_CHAR(day, 'YYYY-MM-DD') AS day,
              SUM(request_count)::int AS requests,
              SUM(total_tokens)::bigint AS tokens,
              SUM(est_cost)::numeric AS cost
       FROM ai_usage_daily${where}
       GROUP BY day ORDER BY day ASC`,
      params,
    );
  }

  /** Per-institute breakdown (super-admin), with names resolved per vertical. */
  async getByInstitute(opts: { vertical?: string; from?: string; to?: string } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    const where = this.filterSql(opts, params);
    const rows = await this.ds.query(
      `SELECT institute_id, vertical,
              SUM(request_count)::int AS requests,
              SUM(success_count)::int AS success,
              SUM(error_count)::int AS errors,
              SUM(total_tokens)::bigint AS tokens,
              SUM(est_cost)::numeric AS cost,
              CASE WHEN SUM(request_count) > 0
                   THEN ROUND(100.0 * SUM(success_count) / SUM(request_count))
                   ELSE 100 END AS success_rate,
              CASE WHEN SUM(request_count) > 0
                   THEN ROUND(SUM(total_latency_ms)::numeric / SUM(request_count))
                   ELSE 0 END AS avg_latency_ms,
              MAX(last_call_at) AS last_call_at
       FROM ai_usage_daily${where}
       GROUP BY institute_id, vertical ORDER BY requests DESC`,
      params,
    );
    return this.resolveInstituteNames(rows);
  }

  /** Billing report grouping by Month, Institute, Feature. */
  async getBillingReport(opts: { vertical?: string; from?: string; to?: string } = {}) {
    await this.ensureTables();
    const params: any[] = [];
    let sql = ` WHERE 1=1`;
    if (opts.from) sql += ` AND day >= $${params.push(opts.from)}`;
    if (opts.to) sql += ` AND day <= $${params.push(opts.to)}`;
    if (opts.vertical) sql += ` AND vertical = $${params.push(opts.vertical)}`;

    const rows = await this.ds.query(
      `SELECT TO_CHAR(day, 'YYYY-MM') AS month,
              institute_id,
              vertical,
              feature,
              SUM(request_count)::int AS requests,
              SUM(total_tokens)::bigint AS tokens,
              SUM(est_cost)::numeric AS cost,
              MAX(last_call_at) AS last_call_at
       FROM ai_usage_daily${sql}
       GROUP BY TO_CHAR(day, 'YYYY-MM'), institute_id, vertical, feature
       ORDER BY month DESC, institute_id ASC, cost DESC`,
      params,
    );
    return this.resolveInstituteNames(rows);
  }

  /** Resolve institute_id → name (coaching=tenants, school=institutes). */
  private async resolveInstituteNames(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;
    const coachingIds = [...new Set(rows.filter((r) => r.vertical === 'coaching').map((r) => r.institute_id))];
    const schoolIds = [...new Set(rows.filter((r) => r.vertical !== 'coaching').map((r) => r.institute_id))];
    const names = new Map<string, string>();
    try {
      if (coachingIds.length) {
        const t = await this.ds.query(`SELECT id, name FROM tenants WHERE id = ANY($1::uuid[])`, [coachingIds]);
        t.forEach((x: any) => names.set(x.id, x.name));
      }
    } catch { /* tenants table optional */ }
    try {
      if (schoolIds.length) {
        const i = await this.schoolDs.query(`SELECT id, name FROM institutes WHERE id = ANY($1::uuid[])`, [schoolIds]);
        i.forEach((x: any) => names.set(x.id, x.name));
      }
    } catch { /* institutes table optional */ }
    return rows.map((r) => ({ ...r, institute_name: names.get(r.institute_id) || r.institute_id }));
  }

  /** A single institute's feature breakdown + remaining quota (institute-admin view). */
  async getForInstitute(instituteId: string, vertical: string, opts: { from?: string; to?: string } = {}) {
    const features = await this.getByFeature({ instituteId, vertical, from: opts.from, to: opts.to });
    const overview = await this.getOverview({ instituteId, vertical, from: opts.from, to: opts.to });
    const quotas = await this.getQuotas(instituteId, vertical);
    // Attach remaining quota per feature (current month) where a limit exists.
    const enriched = await Promise.all(
      features.map(async (f: any) => {
        const q = await this.checkQuota(instituteId, vertical, f.feature);
        return { ...f, limit: q.limit, remaining: q.remaining };
      }),
    );
    return { overview, features: enriched, quotas };
  }

  // ── Quota management (super-admin) ───────────────────────────────────────────

  async getQuotas(instituteId: string, vertical: string) {
    await this.ensureTables();
    return this.ds.query(
      `SELECT feature, monthly_limit, updated_at FROM ai_usage_quotas
       WHERE institute_id=$1 AND vertical=$2 ORDER BY feature`,
      [instituteId, vertical],
    );
  }

  async setQuota(instituteId: string, vertical: string, feature: string, monthlyLimit: number) {
    await this.ensureTables();
    await this.ds.query(
      `INSERT INTO ai_usage_quotas (institute_id, vertical, feature, monthly_limit, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (institute_id, vertical, feature)
       DO UPDATE SET monthly_limit=$4, updated_at=NOW()`,
      [instituteId, vertical, feature || '*', monthlyLimit],
    );
    this.quotaCache.clear();
    return { success: true };
  }

  async deleteQuota(instituteId: string, vertical: string, feature: string) {
    await this.ensureTables();
    await this.ds.query(
      `DELETE FROM ai_usage_quotas WHERE institute_id=$1 AND vertical=$2 AND feature=$3`,
      [instituteId, vertical, feature || '*'],
    );
    this.quotaCache.clear();
    return { success: true };
  }
}
