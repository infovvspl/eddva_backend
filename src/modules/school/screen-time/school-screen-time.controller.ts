import { BadRequestException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolScreenTimeService } from './school-screen-time.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/screen-time')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
export class SchoolScreenTimeController {
  constructor(private readonly svc: SchoolScreenTimeService) {}

  // No @SchoolRoles / @RequireAdminModule here — every authenticated school
  // user (student, teacher, parent, institute admin, staff) reports their own
  // screen time; gating this would stop a restricted admin reporting their
  // own, which is a different concern from who may VIEW the consolidated
  // report below.
  @Post('heartbeat')
  heartbeat(@SchoolUser() user: any) {
    return this.svc.heartbeat(user);
  }

  /** Self-service read — every role's own trend, same shape the parent read maps to. */
  @Get('me')
  async getMyRange(@SchoolUser() user: any, @Query('range') range?: string) {
    const days = range === 'month' ? 30 : 7;
    const result = await this.svc.getRange(user.id, days);
    return { todaySeconds: result.today, totalSeconds: result.total, days: result.days };
  }

  @Get('me/month')
  async getMyMonth(@SchoolUser() user: any, @Query('month') month: string) {
    const [yearStr, monthStr] = String(month || '').split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr);
    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException('Invalid month');
    }
    const result = await this.svc.getMonth(user.id, year, monthNum);
    return { totalSeconds: result.total, days: result.days };
  }

  @Get('me/year')
  async getMyYear(@SchoolUser() user: any, @Query('year') year: string) {
    const yearNum = Number(year);
    if (!yearNum) throw new BadRequestException('Invalid year');
    const result = await this.svc.getYear(user.id, yearNum);
    return { totalSeconds: result.total, months: result.months };
  }

  /** Admin drill-down into one user's trend (e.g. the Students page's detail view). */
  @Get('user/:id')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @RequireAdminModule('screen_time')
  async getUserRange(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Query('range') range?: string,
    @Query('instituteId') instituteIdOverride?: string,
  ) {
    const instituteId = (user.role === 'SUPER_ADMIN' && instituteIdOverride) || user.instituteId;
    await this.svc.assertUserInInstitute(id, instituteId);
    const days = range === 'month' ? 30 : 7;
    const result = await this.svc.getRange(id, days);
    return { todaySeconds: result.today, totalSeconds: result.total, days: result.days };
  }

  @Get('user/:id/month')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @RequireAdminModule('screen_time')
  async getUserMonth(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('instituteId') instituteIdOverride?: string,
  ) {
    const instituteId = (user.role === 'SUPER_ADMIN' && instituteIdOverride) || user.instituteId;
    await this.svc.assertUserInInstitute(id, instituteId);
    const [yearStr, monthStr] = String(month || '').split('-');
    const year = Number(yearStr);
    const monthNum = Number(monthStr);
    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      throw new BadRequestException('Invalid month');
    }
    const result = await this.svc.getMonth(id, year, monthNum);
    return { totalSeconds: result.total, days: result.days };
  }

  @Get('user/:id/year')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @RequireAdminModule('screen_time')
  async getUserYear(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Query('year') year: string,
    @Query('instituteId') instituteIdOverride?: string,
  ) {
    const instituteId = (user.role === 'SUPER_ADMIN' && instituteIdOverride) || user.instituteId;
    await this.svc.assertUserInInstitute(id, instituteId);
    const yearNum = Number(year);
    if (!yearNum) throw new BadRequestException('Invalid year');
    const result = await this.svc.getYear(id, yearNum);
    return { totalSeconds: result.total, months: result.months };
  }

  /** Consolidated per-user report for the institute admin's "Time Spent" page. */
  @Get('institute-report')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @RequireAdminModule('screen_time')
  getInstituteReport(
    @SchoolUser() user: any,
    @Query('range') range?: string,
    @Query('role') role?: string,
    @Query('instituteId') instituteIdOverride?: string,
  ) {
    const days = range === 'month' ? 30 : range === 'today' ? 1 : 7;
    const instituteId = (user.role === 'SUPER_ADMIN' && instituteIdOverride) || user.instituteId;
    return this.svc.getInstituteReport(instituteId, days, role);
  }
}
