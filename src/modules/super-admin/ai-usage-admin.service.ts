import { Injectable } from '@nestjs/common';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiFeatureFlagService } from '../internal/ai-feature-flag.service';
import { AI_FEATURES } from '../../common/constants/ai-features.constant';

type Period = 'today' | 'week' | 'month';
type Product = 'school' | 'coaching' | 'all';

@Injectable()
export class AiUsageAdminService {
  constructor(
    private readonly usageSvc: AiUsageService,
    private readonly flagSvc: AiFeatureFlagService,
  ) {}

  private dateRange(period: Period): { from: string } {
    const now = new Date();
    if (period === 'today') return { from: now.toISOString().slice(0, 10) };
    if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().slice(0, 10) };
    }
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10) };
  }

  async getDashboard(product: Product, period: Period) {
    const { from } = this.dateRange(period);
    const vertical = product === 'all' ? undefined : product;
    const [overview, byFeature, trend] = await Promise.all([
      this.usageSvc.getOverview({ vertical, from }),
      this.usageSvc.getByFeature({ vertical, from }),
      this.usageSvc.getTrend({ vertical, from }),
    ]);
    return {
      totalRequests: Number(overview.requests),
      successRate: overview.requests > 0 ? Math.round((overview.success / overview.requests) * 100) : 100,
      totalTokens: Number(overview.tokens),
      totalCost: parseFloat(Number(overview.cost).toFixed(4)),
      byFeature: (byFeature as any[]).map((f) => ({
        featureId: f.feature,
        label: AI_FEATURES.find((x) => x.id === f.feature)?.label ?? f.feature,
        requests: Number(f.requests),
        cost: parseFloat(Number(f.cost).toFixed(4)),
        successRate: f.requests > 0 ? Math.round((f.success / f.requests) * 100) : 100,
      })),
      dailyRequests: (trend as any[]).map((r) => ({
        date: r.day,
        requests: Number(r.requests),
      })),
    };
  }

  async getByInstitute(product: Product, period: Period, sort: 'requests' | 'cost' | 'latency' = 'cost') {
    const { from } = this.dateRange(period);
    const vertical = product === 'all' ? undefined : product;
    const rows = (await this.usageSvc.getByInstitute({ vertical, from })) as any[];
    return rows.sort((a, b) =>
      sort === 'requests' ? b.requests - a.requests :
      sort === 'cost'     ? b.cost - a.cost :
                            (b.avg_latency_ms ?? 0) - (a.avg_latency_ms ?? 0),
    );
  }

  async getBillingReport(product: Product, fromDate?: string, toDate?: string) {
    const vertical = product === 'all' ? undefined : product;
    return this.usageSvc.getBillingReport({ vertical, from: fromDate, to: toDate });
  }

  async getInstituteDetail(instituteId: string, product: Product, period: Period) {
    const { from } = this.dateRange(period);
    const vertical = product === 'all' ? 'school' : product;
    const instituteType: 'school' | 'coaching' = vertical === 'school' ? 'school' : 'coaching';

    const [rawFeatures, flagMap] = await Promise.all([
      this.usageSvc.getByFeature({ instituteId, vertical, from }) as Promise<any[]>,
      this.flagSvc.getInstituteFlags(instituteId, instituteType),
    ]);

    const features = (rawFeatures as any[]).map((f) => {
      const meta = AI_FEATURES.find((x) => x.id === f.feature);
      const flag = flagMap[f.feature as string];
      const requests = Number(f.requests ?? 0);
      const success = Number(f.success ?? 0);
      return {
        featureId: f.feature as string,
        featureLabel: meta?.label ?? String(f.feature),
        category: meta?.category ?? 'shared',
        requests,
        cost: parseFloat(Number(f.cost ?? 0).toFixed(4)),
        avgLatencyMs: Math.round(Number(f.avg_latency_ms ?? 0)),
        isEnabled: flag?.isEnabled ?? true,
        monthlyLimit: flag?.monthlyLimit ?? null,
        currentUsage: requests,
        successRate: requests > 0 ? Math.round((success / requests) * 100) : 100,
      };
    });

    const totalRequests = features.reduce((s, f) => s + f.requests, 0);
    const totalCost = parseFloat(features.reduce((s, f) => s + f.cost, 0).toFixed(4));
    const totalSuccess = (rawFeatures as any[]).reduce((s, f) => s + Number(f.success ?? 0), 0);
    const successRate = totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 100) : 100;

    return { instituteId, totalRequests, totalCost, successRate, features };
  }

  async getRawLogs(opts: { instituteId?: string; vertical?: string; feature?: string; from?: string; to?: string; limit?: number; offset?: number }) {
    return this.usageSvc.getRawLogs(opts);
  }

  async getFeatureFlags(product: Product) {
    const flagMap = await this.flagSvc.getGlobalFlags(product);
    return AI_FEATURES.map((f) => ({
      featureId: f.id,
      label: f.label,
      category: f.category,
      isEnabled: flagMap[f.id] ?? true,
    }));
  }
}
