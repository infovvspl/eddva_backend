import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { StudyPlanService } from './study-plan.service';
import { GenerateStudyPlanDto, StudyPlanRangeQueryDto } from './dto/study-plan.dto';

@ApiTags('Study Plan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('study-plans')
export class StudyPlanController {
  constructor(private readonly studyPlanService: StudyPlanService) {}

  @Get('courses')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'List all enrolled courses with their study plan status' })
  getCourses(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.studyPlanService.getCoursesWithPlanStatus(user.id, tenantId);
  }

  @Post('generate')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Generate a new study plan for an enrolled course' })
  async generate(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Body() body: GenerateStudyPlanDto,
  ) {
    try {
      return await this.studyPlanService.generatePlan(user.id, tenantId, false, body, body.batchId);
    } catch (e) {
      require('fs').writeFileSync('d:/Edva/eddva_backend/error_gen.log', String(e.stack || e));
      throw e;
    }
  }

  @Post('regenerate')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Force regenerate a course study plan' })
  regenerate(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Body() body: GenerateStudyPlanDto,
  ) {
    return this.studyPlanService.generatePlan(user.id, tenantId, true, body, body.batchId);
  }

  @Post('clear')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Remove a course study plan and items' })
  clear(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Body() body: { batchId?: string },
  ) {
    return this.studyPlanService.clearCurrentPlan(user.id, tenantId, body?.batchId);
  }

  @Get('today')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: "Get today's study plan items for a course" })
  async getToday(
    @Query('batchId') batchId: string | undefined,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    try {
      return await this.studyPlanService.getToday(user.id, tenantId, batchId);
    } catch (e) {
      require('fs').writeFileSync('d:/Edva/eddva_backend/error.log', String(e.stack || e));
      throw e;
    }
  }

  @Get()
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get plan items grouped by date for a course' })
  getRange(
    @Query() query: StudyPlanRangeQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.getRange(user.id, tenantId, query);
  }

  @Patch('items/:itemId/complete')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Mark a plan item complete and award XP' })
  completeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.completeItem(itemId, user.id, tenantId);
  }

  @Patch('items/:itemId/skip')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Skip a plan item and reschedule it' })
  skipItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.skipItem(itemId, user.id, tenantId);
  }

  @Get('next-action')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Get the next priority task for a course plan' })
  getNextAction(
    @Query('batchId') batchId: string | undefined,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.getNextAction(user.id, tenantId, batchId);
  }

  @Post('revision-session')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Start a structured spaced-revision session for a topic' })
  startRevisionSession(
    @Body() body: { topicId: string; accuracy: number; intervalDays: 1 | 3 | 7 | 21 },
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.studyPlanService.startRevisionSession(
      user.id,
      tenantId,
      body.topicId,
      body.accuracy,
      body.intervalDays,
    );
  }
}
