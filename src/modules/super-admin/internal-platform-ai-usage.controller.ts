import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Query } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiFeatureFlagService } from '../internal/ai-feature-flag.service';
import { AI_FEATURES } from '../../common/constants/ai-features.constant';
import { assertInternalKey } from '../internal/internal-key';
import { AiUsageAdminService } from './ai-usage-admin.service';

const PERIODS = ['today', 'week', 'month'] as const;
type Period = (typeof PERIODS)[number];

/**
 * Read-only AI usage for the platform console (eddva_platform). It reuses the same figures the LMS super
 * admin sees, so the two never disagree; the platform calls it with the shared internal key.
 */
const RANGES = ['today', '7d', '15d', '1m', '3m'] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-zA-Z-]{8,64}$/;
const FEATURE = /^[a-z0-9_]{2,64}$/;
const clamp = (n: number, min: number, max: number, fallback: number) => (Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback);

export class FeatureLimitDto {
  @IsBoolean() isEnabled: boolean;
  /** Requests per month; left out keeps the current limit. */
  @IsOptional() @IsNumber() @Min(0) monthlyRequestLimit?: number;
  /** Cost cap per month in USD; left out keeps the current cap. */
  @IsOptional() @IsNumber() @Min(0) monthlyCostCap?: number;
  /** Remove the limit or cap instead of keeping what is there. */
  @IsOptional() @IsBoolean() clearRequestLimit?: boolean;
  @IsOptional() @IsBoolean() clearCostCap?: boolean;
  /** Who changed it, kept on the flag row. */
  @IsString() @MaxLength(128) updatedBy: string;
}

export class GlobalFlagDto {
  @IsBoolean() isEnabled: boolean;
  @IsString() @MaxLength(128) updatedBy: string;
}

function dates(from?: string, to?: string) {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new BadRequestException('Dates must look like 2026-10-31.');
  return { from: from || undefined, to: to || undefined };
}

@Controller('internal/platform/ai-usage')
export class InternalPlatformAiUsageController {
  constructor(
    private readonly usage: AiUsageAdminService,
    private readonly events: AiUsageService,
    private readonly flags: AiFeatureFlagService,
  ) {}

  /** Everything the Overview tab shows for the school vertical: totals, features, models, daily trend and each school. */
  @Get('overview')
  async overview(@Headers('x-internal-key') key: string, @Query('from') from?: string, @Query('to') to?: string) {
    assertInternalKey(key);
    const scope = { vertical: 'school', ...dates(from, to) };
    const [overview, byFeature, byModel, trend, bySchool] = await Promise.all([
      this.events.getOverview(scope),
      this.events.getByFeature(scope),
      this.events.getByModel(scope),
      this.events.getTrend(scope),
      this.events.getByInstitute(scope),
    ]);
    return { overview, byFeature, byModel, trend, bySchool };
  }

  /** Requests, tokens and cost for each month, school and feature. */
  @Get('billing')
  async billing(@Headers('x-internal-key') key: string, @Query('from') from?: string, @Query('to') to?: string) {
    assertInternalKey(key);
    return this.events.getBillingReport({ vertical: 'school', ...dates(from, to) });
  }

  /** The AI calls themselves, newest first. */
  @Get('logs')
  async logs(
    @Headers('x-internal-key') key: string,
    @Query('instituteId') instituteId?: string,
    @Query('feature') feature?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertInternalKey(key);
    if (instituteId && !ID.test(instituteId)) throw new BadRequestException('instituteId must be an id');
    if (feature && !FEATURE.test(feature)) throw new BadRequestException('feature must be a feature id');
    const size = clamp(Number(pageSize), 1, 100, 10);
    const pageNo = clamp(Number(page), 1, 100000, 1);
    const res = await this.events.getRawLogs({ instituteId, vertical: 'school', feature, success: status === 'success' ? true : status === 'failed' ? false : undefined, ...dates(from, to), limit: size, offset: (pageNo - 1) * size });
    return { items: res.data, total: res.total, page: pageNo, pageSize: size };
  }

  /** Whether each AI feature is switched on for every school (the LMS's platform-wide setting). */
  @Get('feature-flags')
  async featureFlags(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    return this.usage.getFeatureFlags('school');
  }

  /** Turns one AI feature on or off for every school (a school's own setting still wins). */
  @Patch('feature-flags/:featureId')
  @HttpCode(200)
  async setGlobalFlag(@Headers('x-internal-key') key: string, @Param('featureId') featureId: string, @Body() dto: GlobalFlagDto) {
    assertInternalKey(key);
    if (!FEATURE.test(featureId)) throw new BadRequestException('featureId must be a feature id');
    if (!AI_FEATURES.some((f) => f.id === featureId)) throw new BadRequestException('That is not an AI feature.');
    return this.flags.setFeatureFlag({ featureId, scope: 'global', instituteType: 'school', isEnabled: dto.isEnabled, updatedBy: dto.updatedBy });
  }

  /** One school's usage for a period, with every AI feature listed (used or not) and its on/off state and limits. */
  @Get('schools/:id')
  async school(@Headers('x-internal-key') key: string, @Param('id') id: string, @Query('period') period: string = 'month') {
    assertInternalKey(key);
    if (!ID.test(id)) throw new BadRequestException('id must be an institute id');
    if (!PERIODS.includes(period as Period)) throw new BadRequestException(`period must be one of ${PERIODS.join(', ')}`);
    const detail = await this.usage.getInstituteDetail(id, 'school', period as Period);
    const used = new Map(detail.features.map((f) => [f.featureId, f]));
    const flags = await this.flags.getInstituteFlags(id, 'school');
    const features = [
      ...AI_FEATURES.map((f) => used.get(f.id) ?? { featureId: f.id, featureLabel: f.label, category: f.category, requests: 0, tokens: 0, cost: 0, avgLatencyMs: 0, isEnabled: flags[f.id]?.isEnabled ?? true, monthlyLimit: flags[f.id]?.monthlyLimit ?? null, monthlyCostCap: flags[f.id]?.monthlyCostCap ?? null, currentUsage: 0, successRate: 100 }),
      // Features that appear in usage but are not in the catalogue (older or renamed ones) still show.
      ...detail.features.filter((f) => !AI_FEATURES.some((c) => c.id === f.featureId)),
    ];
    return { ...detail, features };
  }

  /** Turns one AI feature on or off for one school and sets its monthly limits. */
  @Patch('schools/:id/features/:featureId')
  @HttpCode(200)
  async setSchoolFeature(@Headers('x-internal-key') key: string, @Param('id') id: string, @Param('featureId') featureId: string, @Body() dto: FeatureLimitDto) {
    assertInternalKey(key);
    if (!ID.test(id)) throw new BadRequestException('id must be an institute id');
    if (!FEATURE.test(featureId)) throw new BadRequestException('featureId must be a feature id');
    return this.flags.setFeatureFlag({ featureId, scope: 'institute', instituteId: id, instituteType: 'school', isEnabled: dto.isEnabled, monthlyRequestLimit: dto.monthlyRequestLimit, monthlyCostCap: dto.monthlyCostCap, clearRequestLimit: dto.clearRequestLimit, clearCostCap: dto.clearCostCap, updatedBy: dto.updatedBy });
  }

  @Get('summary')
  async summary(@Headers('x-internal-key') key: string, @Query('period') period: string = 'month') {
    assertInternalKey(key);
    if (!PERIODS.includes(period as Period)) throw new BadRequestException(`period must be one of ${PERIODS.join(', ')}`);
    const [dashboard, byInstitute] = await Promise.all([
      this.usage.getDashboard('all', period as Period),
      this.usage.getByInstitute('all', period as Period, 'cost'),
    ]);
    return { period, dashboard, byInstitute };
  }

  /** Successful and failed calls over time, for the dashboard's AI usage chart. */
  @Get('trend')
  async trend(@Headers('x-internal-key') key: string, @Query('range') range: string = '7d') {
    assertInternalKey(key);
    if (!(RANGES as readonly string[]).includes(range)) throw new BadRequestException(`range must be one of ${RANGES.join(', ')}`);
    return this.usage.getSeries(range as (typeof RANGES)[number]);
  }
}
