import { Controller, Get, Patch, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageAdminService } from './ai-usage-admin.service';
import { AiFeatureFlagService } from '../internal/ai-feature-flag.service';
import { SchoolJwtGuard } from '../school/guards/school-jwt.guard';
import { SchoolRolesGuard } from '../school/guards/school-roles.guard';
import { SchoolRoles } from '../school/decorators/school-roles.decorator';

@ApiTags('Super Admin - AI Usage')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('SUPER_ADMIN')
@Controller('school/super-admin/ai-usage')
export class AiUsageAdminController {
  constructor(
    private readonly usageService: AiUsageAdminService,
    private readonly flagService: AiFeatureFlagService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'AI usage dashboard — totals, by-feature, daily trend' })
  getDashboard(
    @Query('product') product: 'school' | 'coaching' | 'all' = 'all',
    @Query('period') period: 'today' | 'week' | 'month' = 'month',
  ) {
    return this.usageService.getDashboard(product, period);
  }

  @Get('by-institute')
  @ApiOperation({ summary: 'AI usage grouped by institute' })
  getByInstitute(
    @Query('product') product: 'school' | 'coaching' | 'all' = 'all',
    @Query('period') period: 'today' | 'week' | 'month' = 'month',
    @Query('sort') sort: 'requests' | 'cost' | 'latency' = 'cost',
  ) {
    return this.usageService.getByInstitute(product, period, sort);
  }

  @Get('institute/:id')
  @ApiOperation({ summary: 'AI usage detail for a specific institute' })
  getInstituteDetail(
    @Param('id') id: string,
    @Query('product') product: 'school' | 'coaching' | 'all' = 'all',
    @Query('period') period: 'today' | 'week' | 'month' = 'month',
  ) {
    return this.usageService.getInstituteDetail(id, product, period);
  }

  @Get('feature-flags')
  @ApiOperation({ summary: 'Get all global feature flag states' })
  getFeatureFlags(
    @Query('product') product: 'school' | 'coaching' | 'all' = 'all',
  ) {
    return this.usageService.getFeatureFlags(product);
  }

  @Patch('feature-flags/:featureId')
  @ApiOperation({ summary: 'Set a global feature flag (enable/disable for all institutes)' })
  async setGlobalFlag(
    @Param('featureId') featureId: string,
    @Body() body: { product: 'school' | 'coaching'; isEnabled: boolean },
    @Request() req: { user?: { id?: string } },
  ) {
    return this.flagService.setFeatureFlag({
      featureId,
      scope: 'global',
      instituteType: body.product,
      isEnabled: body.isEnabled,
      updatedBy: req.user?.id ?? 'super-admin',
    });
  }

  @Patch('institute/:instituteId/features/:featureId')
  @ApiOperation({ summary: 'Set a per-institute feature flag with optional quota' })
  async setInstituteFlag(
    @Param('instituteId') instituteId: string,
    @Param('featureId') featureId: string,
    @Body() body: {
      product: 'school' | 'coaching';
      isEnabled: boolean;
      monthlyRequestLimit?: number;
      monthlyCostCap?: number;
    },
    @Request() req: { user?: { id?: string } },
  ) {
    return this.flagService.setFeatureFlag({
      featureId,
      scope: 'institute',
      instituteId,
      instituteType: body.product,
      isEnabled: body.isEnabled,
      monthlyRequestLimit: body.monthlyRequestLimit,
      monthlyCostCap: body.monthlyCostCap,
      updatedBy: req.user?.id ?? 'super-admin',
    });
  }

  @Get('logs')
  @ApiOperation({ summary: 'Get raw AI logs' })
  getRawLogs(
    @Query('instituteId') instituteId?: string,
    @Query('product') product?: 'school' | 'coaching' | 'all',
    @Query('feature') feature?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.usageService.getRawLogs({
      instituteId,
      vertical: product,
      feature,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('reports/billing')
  @ApiOperation({ summary: 'Get billing report' })
  getBillingReport(
    @Query('product') product?: 'school' | 'coaching' | 'all',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usageService.getBillingReport(product || 'all', from, to);
  }
}
