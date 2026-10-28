import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolDashboardService } from './school-dashboard.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

@Controller('school')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolDashboardController {
  constructor(private readonly svc: SchoolDashboardService) {}

  @Get('dashboard/stats') stats(@SchoolUser() user: any, @Query('portal') portal?: string) {
    return this.svc.stats(user, portal);
  }

  @Get('admin/stats') adminStats(@SchoolUser() user: any) { return this.svc.adminStats(user); }

  @Get('admin/attention-flags') attentionFlags(@SchoolUser() user: any) { return this.svc.getAllAttentionFlags(user); }

  @Get('search')
  search(@SchoolUser() user: any, @Query('q') q = '') {
    return this.svc.search(user, q);
  }

  @Get('dashboard/birthdays')
  birthdays(@SchoolUser() user: any, @Query('days') days?: string) {
    return this.svc.birthdays(user, days ? parseInt(days, 10) : undefined);
  }

  @Get('teacher/habitual-absentees')
  @SchoolRoles('TEACHER')
  habitualAbsentees(@SchoolUser() user: any, @Query('days') days?: string) {
    return this.svc.teacherHabitualAbsentees(user, days ? parseInt(days, 10) : undefined);
  }

  @Get('dashboard/fee-notices')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  feeNotices(@SchoolUser() user: any, @Query('days') days?: string) {
    return this.svc.feeNotices(user, days ? parseInt(days, 10) : undefined);
  }
}
