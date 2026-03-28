import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { AnalyticsService } from './analytics.service';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardQueryDto, LogEngagementDto, PerformanceQueryDto } from './dto/analytics.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  @Get('performance')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get performance profile and weak topics' })
  getPerformance(
    @Query() query: PerformanceQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.analyticsService.getPerformance(user, tenantId, query.studentId);
  }

  @Post('performance/refresh')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Refresh performance profile from assessment history' })
  refreshPerformance(
    @Query() query: PerformanceQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.analyticsService.refreshPerformance(user, tenantId, query.studentId);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Get leaderboard entries' })
  getLeaderboard(
    @Query() query: LeaderboardQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.leaderboardService.getLeaderboard(query, user, tenantId);
  }

  @Post('engagement')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Log engagement state for a lecture' })
  logEngagement(
    @Body() dto: LogEngagementDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.analyticsService.logEngagement(dto, user.id, tenantId);
  }

  @Get('engagement/:lectureId')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get engagement summary for a lecture' })
  @ApiParam({ name: 'lectureId', type: 'string' })
  getLectureEngagement(
    @Param('lectureId', ParseUUIDPipe) lectureId: string,
    @TenantId() tenantId: string,
  ) {
    return this.analyticsService.getLectureEngagementSummary(lectureId, tenantId);
  }
}
