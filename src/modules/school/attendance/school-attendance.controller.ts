import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/attendance')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolAttendanceController {
  constructor(private readonly svc: SchoolAttendanceService) {}

  @Post() mark(@SchoolUser() user: any, @Body() body: any) { return this.svc.mark(user, body); }
  @Get() get(@SchoolUser() user: any, @Query() query: any) { return this.svc.get(user, query); }
  @Post('session') markSession(@SchoolUser() user: any, @Body() body: any) { return this.svc.markSession(user, body); }
  @Get('report') getReport() { return this.svc.getReport(); }
  @Get('class/:classId/students') getStudentsByClass(@Param('classId') id: string) { return this.svc.getStudentsByClass(id); }

  @Get('students')
  getStudentsByClassAndSection(
    @Query('classId') classId: string,
    @Query('sectionId') sectionId: string,
  ) {
    return this.svc.getStudentsByClassAndSection(classId, sectionId);
  }

  @Get('dashboard-stats')
  getDashboardStats(@SchoolUser() user: any) {
    return this.svc.getDashboardStats(user);
  }

  @Get('history')
  getHistory(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getHistory(user, query);
  }

  @Get('session/:sessionId')
  getSessionDetails(@SchoolUser() user: any, @Param('sessionId') sessionId: string) {
    return this.svc.getSessionDetails(user, sessionId);
  }
}
