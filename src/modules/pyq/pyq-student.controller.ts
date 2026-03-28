import {
  Body, Controller, Get, Param, ParseUUIDPipe,
  Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { PYQService } from './pyq.service';
import { PYQFilterDto, StartPYQSessionDto, SubmitPYQAnswerDto } from './dto/pyq.dto';

@ApiTags('Student — PYQ Practice')
@Controller('assessments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class PYQStudentController {
  constructor(private readonly pyqService: PYQService) {}

  // S1 — Overview for a topic (year grid)
  @Get('topics/:topicId/pyqs/overview')
  @ApiOperation({ summary: 'PYQ year grid + student progress for a topic' })
  async getOverview(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.getPYQOverview(topicId, user.id, tenantId);
  }

  // S2 — Filtered list
  @Get('topics/:topicId/pyqs')
  @ApiOperation({ summary: 'Get PYQs for a topic (with filters)' })
  async getPYQs(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Query() filter: PYQFilterDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.getPYQs(topicId, user.id, tenantId, filter);
  }

  // S3 — Submit answer
  @Post('topics/:topicId/pyqs/:questionId/submit')
  @ApiOperation({ summary: 'Submit answer for one PYQ — reveals correct answer' })
  async submit(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: SubmitPYQAnswerDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.submitPYQAnswer(topicId, questionId, user.id, tenantId, dto);
  }

  // S4 — Start a practice session
  @Post('topics/:topicId/pyqs/start-session')
  @ApiOperation({ summary: 'Start a PYQ practice session (filtered batch of questions)' })
  async startSession(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: StartPYQSessionDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.startPYQSession(topicId, user.id, tenantId, dto);
  }

  // S5 — Student's progress on this topic
  @Get('topics/:topicId/pyqs/my-progress')
  @ApiOperation({ summary: "Student's PYQ history and accuracy for a topic" })
  async myProgress(
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.getMyProgress(topicId, user.id, tenantId);
  }

  // S6 — Chapter-level overview
  @Get('chapters/:chapterId/pyqs/overview')
  @ApiOperation({ summary: 'PYQ availability and progress for every topic in a chapter' })
  async chapterOverview(
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.pyqService.getChapterPYQOverview(chapterId, user.id, tenantId);
  }
}
