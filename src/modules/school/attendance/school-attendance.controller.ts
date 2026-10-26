import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Audit } from '../../audit-log/audit.decorator';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/attendance')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, AdminModuleGuard)
@RequireAdminModule('attendance')
export class SchoolAttendanceController {
  constructor(private readonly svc: SchoolAttendanceService) {}

  // Student attendance is taken by the teacher; admin's role here is
  // view-only (reports, roster, history). Marking/taking it stays
  // TEACHER-only — this overrides the class-level guard for just these two
  // write routes.
  @Post()
  @SchoolRoles('TEACHER')
  @Audit({ module: 'Academic', action: 'Attendance Save', description: 'Marked daily attendance' })
  mark(@SchoolUser() user: any, @Body() body: any) { return this.svc.mark(user, body); }

  @Get() get(@SchoolUser() user: any, @Query() query: any) { return this.svc.get(user, query); }

  @Post('session')
  @SchoolRoles('TEACHER')
  @Audit({ module: 'Academic', action: 'Attendance Save', description: 'Marked session attendance' })
  markSession(@SchoolUser() user: any, @Body() body: any) { return this.svc.markSession(user, body); }
  @Get('report') getReport() { return this.svc.getReport(); }
  @Get('class/:classId/students')
  getStudentsByClass(@SchoolUser() user: any, @Param('classId') id: string) {
    return this.svc.getStudentsByClass(user, id);
  }

  @Get('students')
  getStudentsByClassAndSection(
    @SchoolUser() user: any,
    @Query('classId') classId: string,
    @Query('sectionId') sectionId: string,
    @Query() query: any
  ) {
    return this.svc.getStudentsByClassAndSection(user, classId, sectionId, query);
  }

  @Get('dashboard-stats')
  getDashboardStats(@SchoolUser() user: any) {
    return this.svc.getDashboardStats(user);
  }

  @Get('below-threshold')
  getBelowThreshold(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getBelowThreshold(user, query);
  }

  @Get('history')
  getHistory(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getHistory(user, query);
  }

  @Get('session/check')
  checkSession(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.checkSession(user, query);
  }

  @Get('session/:sessionId')
  getSessionDetails(@SchoolUser() user: any, @Param('sessionId') sessionId: string) {
    return this.svc.getSessionDetails(user, sessionId);
  }
}
