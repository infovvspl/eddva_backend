import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolActivityService } from './school-activity.service';
import { AppHeartbeatDto } from './school-activity.dto';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';
import { SchoolScreenTimeService } from '../screen-time/school-screen-time.service';

@Controller('school/activity')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
export class SchoolActivityController {
  constructor(
    private readonly svc: SchoolActivityService,
    private readonly screenTimeService: SchoolScreenTimeService,
  ) {}

  // No @SchoolRoles here — every authenticated school user reports their own
  // page-category activity, same reasoning as the generic screen-time
  // heartbeat (school-screen-time.controller.ts): who may VIEW the
  // consolidated report is a separate, more restricted concern.
  @Post('heartbeat')
  heartbeat(@SchoolUser() user: any, @Body() dto: AppHeartbeatDto) {
    return this.svc.recordHeartbeat(user, dto);
  }

  @Get('me')
  getMyBreakdown(@SchoolUser() user: any, @Query('range') range?: string) {
    const days = range === 'year' ? 365 : range === 'month' ? 30 : range === 'today' ? 1 : 7;
    return this.svc.getMyBreakdown(user, days);
  }

  /** Admin drill-down into one user's category breakdown (e.g. an expanded row on the "Time Spent" report). */
  @Get('user/:id')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @RequireAdminModule('screen_time')
  async getUserBreakdown(
    @SchoolUser() user: any,
    @Param('id') id: string,
    @Query('range') range?: string,
    @Query('instituteId') instituteIdOverride?: string,
  ) {
    const instituteId = (user.role === 'SUPER_ADMIN' && instituteIdOverride) || user.instituteId;
    await this.screenTimeService.assertUserInInstitute(id, instituteId);
    const days = range === 'year' ? 365 : range === 'month' ? 30 : range === 'today' ? 1 : 7;
    return this.svc.getBreakdown(id, days);
  }
}
