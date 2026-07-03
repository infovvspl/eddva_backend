import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AiUsageService } from '../../ai-usage/ai-usage.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

/**
 * AI usage + quota endpoints.
 * - SUPER_ADMIN: platform-wide (all institutes, both verticals) + quota management.
 * - INSTITUTE_ADMIN: scoped to their own institute (school vertical) only.
 */
@Controller('school/ai-usage')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAiUsageController {
  constructor(private readonly svc: AiUsageService) {}

  /** Resolve query scope based on role: super-admin = anything; others = own institute. */
  private scope(user: any, q: any) {
    if (user.role === 'SUPER_ADMIN') {
      return { instituteId: q.instituteId || undefined, vertical: q.vertical || undefined, from: q.from, to: q.to };
    }
    return { instituteId: user.instituteId, vertical: 'school', from: q.from, to: q.to };
  }

  @Get('overview')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async overview(@SchoolUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getOverview(this.scope(user, q)) };
  }

  @Get('by-feature')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async byFeature(@SchoolUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getByFeature(this.scope(user, q)) };
  }

  @Get('trend')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async trend(@SchoolUser() user: any, @Query() q: any) {
    return { success: true, data: await this.svc.getTrend(this.scope(user, q)) };
  }

  @Get('by-institute')
  @SchoolRoles('SUPER_ADMIN')
  async byInstitute(@Query() q: any) {
    return { success: true, data: await this.svc.getByInstitute({ vertical: q.vertical || undefined, from: q.from, to: q.to }) };
  }

  /** A single institute's breakdown + remaining quota. */
  @Get('me')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async me(@SchoolUser() user: any, @Query() q: any) {
    const instituteId = user.role === 'SUPER_ADMIN' ? q.instituteId : user.instituteId;
    const vertical = user.role === 'SUPER_ADMIN' ? (q.vertical || 'school') : 'school';
    if (!instituteId) throw new BadRequestException('instituteId is required');
    return { success: true, data: await this.svc.getForInstitute(instituteId, vertical, { from: q.from, to: q.to }) };
  }

  // ── Quota management (super-admin only) ──────────────────────────────────────

  @Get('quotas')
  @SchoolRoles('SUPER_ADMIN')
  async getQuotas(@Query() q: any) {
    if (!q.instituteId) throw new BadRequestException('instituteId is required');
    return { success: true, data: await this.svc.getQuotas(q.instituteId, q.vertical || 'school') };
  }

  @Post('quotas')
  @SchoolRoles('SUPER_ADMIN')
  async setQuota(@Body() b: any) {
    if (!b.instituteId || b.monthlyLimit == null) throw new BadRequestException('instituteId and monthlyLimit are required');
    return this.svc.setQuota(b.instituteId, b.vertical || 'school', b.feature || '*', Number(b.monthlyLimit));
  }

  @Delete('quotas')
  @SchoolRoles('SUPER_ADMIN')
  async deleteQuota(@Body() b: any) {
    if (!b.instituteId) throw new BadRequestException('instituteId is required');
    return this.svc.deleteQuota(b.instituteId, b.vertical || 'school', b.feature || '*');
  }

  @Get('logs')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async getRawLogs(@SchoolUser() user: any, @Query() q: any) {
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

  @Get('debug')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async debug() {
    return this.svc.debugState();
  }

  /**
   * Diagnostic endpoint: returns the logged-in user's identity + overview
   * for their specific institute. Useful to verify institute_id matching.
   * The frontend calls this automatically when analytics shows 0.
   */
  @Get('me-debug')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER')
  async meDebug(@SchoolUser() user: any) {
    const instituteId = user?.instituteId ?? null;
    let overviewResult: any = null;
    let queryError: string | null = null;
    try {
      overviewResult = await this.svc.getOverview({
        instituteId: instituteId || undefined,
        vertical: 'school',
      });
    } catch (e: any) {
      queryError = e?.message || String(e);
    }
    return {
      success: true,
      // Flatten user fields so the frontend can read them at the top level
      id: user?.id,
      email: user?.email,
      role: user?.role,
      instituteId,
      user: { id: user?.id, email: user?.email, role: user?.role, instituteId },
      overview: overviewResult,
      queryError,
    };
  }
}
