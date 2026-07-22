import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { AiUsageService } from './ai-usage.service';

/**
 * Coaching-side AI usage + quota endpoints.
 * - SUPER_ADMIN: platform-wide (all institutes, both verticals) + quota management.
 * - INSTITUTE_ADMIN: scoped to their own tenant (coaching vertical) only.
 *
 * Routes live at /ai-usage/* (coaching has no vertical prefix).
 */
@ApiTags('AI Usage')
@ApiBearerAuth()
@Controller('ai-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiUsageController {
  constructor(private readonly svc: AiUsageService) {}

  private scope(user: any, q: any) {
    if (user?.role === UserRole.SUPER_ADMIN) {
      return { instituteId: q.instituteId || undefined, vertical: q.vertical || undefined, from: q.from, to: q.to };
    }
    return { instituteId: user?.tenantId, vertical: 'coaching', from: q.from, to: q.to };
  }

  @Get('overview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async overview(@CurrentUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getOverview(this.scope(user, q)) };
  }

  @Get('by-feature')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async byFeature(@CurrentUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getByFeature(this.scope(user, q)) };
  }

  @Get('trend')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async trend(@CurrentUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getTrend(this.scope(user, q)) };
  }

  @Get('by-institute')
  @Roles(UserRole.SUPER_ADMIN)
  async byInstitute(@Query() q: any) {
    return { success: true, data: await this.svc.getByInstitute({ vertical: q.vertical || undefined, from: q.from, to: q.to }) };
  }

  @Get('logs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async logs(@CurrentUser() user: any, @Query() q: any) {
    const instituteId = user?.role === UserRole.SUPER_ADMIN ? q.instituteId : user?.tenantId;
    const vertical = user?.role === UserRole.SUPER_ADMIN ? (q.vertical || 'coaching') : 'coaching';
    if (!instituteId && user?.role !== UserRole.SUPER_ADMIN) throw new BadRequestException('instituteId is required');
    
    return { 
      success: true, 
      ...(await this.svc.getRawLogs({ 
        instituteId: instituteId || undefined, 
        vertical: vertical || undefined, 
        feature: q.feature || undefined,
        limit: q.limit ? Number(q.limit) : 100,
        offset: q.offset ? Number(q.offset) : 0,
        from: q.from, 
        to: q.to 
      })) 
    };
  }

  @Get('me')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async me(@CurrentUser() user: any, @Query() q: any) {
    const instituteId = user?.role === UserRole.SUPER_ADMIN ? q.instituteId : user?.tenantId;
    const vertical = user?.role === UserRole.SUPER_ADMIN ? (q.vertical || 'coaching') : 'coaching';
    if (!instituteId) throw new BadRequestException('instituteId is required');
    return { success: true, data: await this.svc.getForInstitute(instituteId, vertical, { from: q.from, to: q.to }) };
  }

  @Get('quotas')
  @Roles(UserRole.SUPER_ADMIN)
  async getQuotas(@Query() q: any) {
    if (!q.instituteId) throw new BadRequestException('instituteId is required');
    return { success: true, data: await this.svc.getQuotas(q.instituteId, q.vertical || 'coaching') };
  }

  @Post('quotas')
  @Roles(UserRole.SUPER_ADMIN)
  async setQuota(@Body() b: any) {
    if (!b.instituteId || b.monthlyLimit == null) throw new BadRequestException('instituteId and monthlyLimit are required');
    return this.svc.setQuota(b.instituteId, b.vertical || 'coaching', b.feature || '*', Number(b.monthlyLimit));
  }

  @Delete('quotas')
  @Roles(UserRole.SUPER_ADMIN)
  async deleteQuota(@Body() b: any) {
    if (!b.instituteId) throw new BadRequestException('instituteId is required');
    return this.svc.deleteQuota(b.instituteId, b.vertical || 'coaching', b.feature || '*');
  }

  @Get('logs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.INSTITUTE_ADMIN)
  async getRawLogs(@CurrentUser() user: any, @Query() q: any) {
    const scope = this.scope(user, q);
    return this.svc.getRawLogs({
      instituteId: scope.instituteId || undefined,
      vertical: scope.vertical,
      feature: q.feature || undefined,
      from: scope.from,
      to: scope.to,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  }
}
