import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { SchoolJwtGuard } from '../../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../../guards/school-roles.guard';
import { SchoolFeatureGuard } from '../../guards/school-feature.guard';
import { SchoolFeature } from '../../decorators/school-feature.decorator';
import { SchoolRoles } from '../../decorators/school-roles.decorator';
import { SchoolUser } from '../../decorators/school-user.decorator';
import { LearningReportService } from './learning-report.service';

export class LearningReportQueryDto {
  @IsOptional() @IsIn(['today', 'week', 'month', 'year']) period?: string;
  @IsOptional() @IsIn(['day', 'week', 'month', 'year']) trend?: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @IsUUID() sectionId?: string;
  @IsOptional() @IsUUID() subjectId?: string;
  /** Super admins only: which school. */
  @IsOptional() @IsUUID() instituteId?: string;
}

export class StudentRefParam {
  /** The student's id or their user id. */
  @IsString() @IsUUID() id: string;
}

/**
 * Study-planner reports. Who sees which students and subjects is decided by
 * ReportScopeService: admins the whole school, class teachers their sections
 * (every subject), subject teachers their subject in the sections they teach,
 * parents their own children.
 */
@Controller('school/learning/reports')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('ai', 'ai_study_planner')
export class LearningReportsController {
  constructor(private readonly reports: LearningReportService) {}

  @Get('overview')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN', 'TEACHER')
  overview(@SchoolUser() user: any, @Query() query: LearningReportQueryDto) {
    return this.reports.overview(user, query);
  }

  @Get('students/:id')
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN', 'TEACHER', 'PARENT')
  student(@SchoolUser() user: any, @Param() params: StudentRefParam, @Query() query: LearningReportQueryDto) {
    return this.reports.student(user, params.id, query);
  }

  @Get('children')
  @SchoolRoles('PARENT')
  children(@SchoolUser() user: any) {
    return this.reports.children(user);
  }
}
