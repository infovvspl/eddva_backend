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

  async getInstituteDetail(instituteId: string, product: Product, period: Period) {
    const { from } = this.dateRange(period);
    const vertical = product === 'all' ? 'coaching' : product;
    return this.usageSvc.getForInstitute(instituteId, vertical, { from });
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
