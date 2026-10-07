import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolReportCardRemarksService } from './school-report-card-remarks.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

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
  @Get('student') studentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.studentReport(user, query); }
  @Get('assessment') assessmentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.assessmentReport(user, query); }
  @Get('teacher/class') teacherClassReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.teacherClassReport(user, query); }

  @Get('report-card-remarks') getReportCardRemarks(@SchoolUser() user: any, @Query() query: any) { return this.remarksSvc.get(user, query); }
  @Put('report-card-remarks') saveReportCardRemarks(@SchoolUser() user: any, @Body() body: any) { return this.remarksSvc.save(user, body); }
}
