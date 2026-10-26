import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolReportCardRemarksService } from './school-report-card-remarks.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/reports')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('module', 'reports')
export class SchoolReportController {
  constructor(
    private readonly svc: SchoolReportService,
    private readonly remarksSvc: SchoolReportCardRemarksService,
  ) {}

  @Get('class') classReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.classReport(user, query); }
  @Get('my-analytics') myAnalytics(@SchoolUser() user: any) { return this.svc.myStudentAnalytics(user); }
  @Get('student-analytics') studentAnalytics(@SchoolUser() user: any, @Query('studentId') studentId: string) { return this.svc.studentAnalyticsFor(user, studentId); }
  @Get('student-performance') studentPerformance(@SchoolUser() user: any, @Query('studentId') studentId: string) { return this.svc.studentPerformance(user, studentId); }
  @Get('student') studentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.studentReport(user, query); }
  @Get('assessment') assessmentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.assessmentReport(user, query); }
  @Get('teacher/class') teacherClassReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.teacherClassReport(user, query); }

  @Get('report-card-remarks') getReportCardRemarks(@SchoolUser() user: any, @Query() query: any) { return this.remarksSvc.get(user, query); }
  @Put('report-card-remarks') saveReportCardRemarks(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.save(user, body); }

  @Get('report-card-status') getReportCardStatus(@SchoolUser() user: any, @Query() query: any) { return this.remarksSvc.getStatus(user, query); }

  @Post('report-card-publish')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'ReportCard', action: 'Report Card Publish', description: 'Published report card for student {body.studentId}' })
  publishReportCard(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.publish(user, body); }

  @Post('report-card-approve')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'ReportCard', action: 'Report Card Approve', description: 'Approved report card for student {body.studentId}' })
  approveReportCard(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.approve(user, body); }

  @Post('report-card-reject')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  @Audit({ module: 'ReportCard', action: 'Report Card Reject', description: 'Rejected report card for student {body.studentId}' })
  rejectReportCard(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.reject(user, body); }

  @Post('report-card-check')
  @SchoolRoles('PARENT')
  @Audit({ module: 'ReportCard', action: 'Report Card Acknowledged', description: 'Parent acknowledged report card for student {body.studentId}' })
  checkReportCard(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.markChecked(user, body); }

  @Get('report-card-check-status')
  @SchoolRoles('TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getReportCardCheckStatus(@SchoolUser() user: any, @Query() query: any) { return this.remarksSvc.getCheckedStatus(user, query); }
}
