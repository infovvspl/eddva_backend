import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { TeacherAnalyticsService } from './teacher-analytics.service';
import {
  ClassPerformanceQueryDto,
  ExportQueryDto,
  TeacherAnalyticsQueryDto,
} from './dto/teacher-analytics.dto';

@ApiTags('Teacher Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
@Controller('analytics/teacher')
export class TeacherAnalyticsController {
  constructor(private readonly service: TeacherAnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Teacher analytics overview — totals, batch list, avg scores' })
  getOverview(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getOverview(user.id, tenantId, query);
  }

  @Get('class-performance')
  @ApiOperation({ summary: 'Per-student performance table with sorting & pagination' })
  getClassPerformance(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: ClassPerformanceQueryDto,
  ) {
    return this.service.getClassPerformance(user.id, tenantId, query);
  }

  @Get('topic-coverage')
  @ApiOperation({ summary: 'Topic coverage — which topics have the most struggling students' })
  getTopicCoverage(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getTopicCoverage(user.id, tenantId, query);
  }

  @Get('engagement-heatmap/:lectureId')
  @ApiOperation({ summary: 'Engagement heatmap for a specific lecture' })
  getEngagementHeatmap(
    @Param('lectureId', ParseUUIDPipe) lectureId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.service.getEngagementHeatmap(user.id, tenantId, lectureId);
  }

  @Get('doubt-analytics')
  @ApiOperation({ summary: 'Doubt analytics — volume, resolution rate, top topics' })
  getDoubtAnalytics(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getDoubtAnalytics(user.id, tenantId, query);
  }

  @Get('student/:studentId')
  @ApiOperation({ summary: 'Deep dive analytics for a specific student' })
  getStudentDeepDive(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getStudentDeepDive(user.id, tenantId, studentId, query);
  }

  @Get('batch-comparison')
  @ApiOperation({ summary: 'Compare performance across all teacher batches' })
  getBatchComparison(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getBatchComparison(user.id, tenantId, query);
  }

  @Get('smart-insights')
  @ApiOperation({ summary: 'AI-generated smart insights for the teacher' })
  getSmartInsights(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: TeacherAnalyticsQueryDto,
  ) {
    return this.service.getSmartInsights(user.id, tenantId, query.batchId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export analytics as CSV' })
  async exportCsv(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    const rows = await this.service.exportCsv(user.id, tenantId, query);
    if (!rows.length) {
      return res.status(200).json([]);
    }

    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((h) => {
            const val = (row as any)[h] ?? '';
            return `"${String(val).replace(/"/g, '""')}"`;
          })
          .join(','),
      ),
    ];
    const csv = csvLines.join('\n');

    const type = query.type || 'analytics';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-${Date.now()}.csv"`);
    return res.send(csv);
  }
}