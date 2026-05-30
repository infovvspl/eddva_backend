import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolReportService } from './school-report.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/reports')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolReportController {
  constructor(private readonly svc: SchoolReportService) {}

  @Get('student') studentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.studentReport(user, query); }
  @Get('assessment') assessmentReport(@SchoolUser() user: any, @Query() query: any) { return this.svc.assessmentReport(user, query); }
}
