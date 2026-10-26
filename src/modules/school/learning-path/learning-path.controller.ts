import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { MasteryQueryService } from './mastery/mastery-query.service';
import { QuizEngineService } from './quiz/quiz-engine.service';
import { AiNotesService } from './notes/ai-notes.service';
import { LearningThreadService } from './threads/learning-thread.service';
import { ThreadChatService } from './threads/thread-chat.service';
import { ActivityService } from './activity/activity.service';
import { LearningHomeService } from './home/learning-home.service';
import {
  HeartbeatDto,
  OpenStepDto,
  OpenThreadDto,
  PostThreadMessageDto,
  SaveChatQuizResultDto,
  QuizAnswersDto,
  RecomputeMasteryDto,
  SaveNotesDto,
  StepProgressDto,
  ThreadPageQueryDto,
} from './learning-path.dto';

@Controller('school/learning')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('ai', 'ai_study_planner')
export class LearningPathController {
  constructor(
    private readonly mastery: MasteryQueryService,
    private readonly quiz: QuizEngineService,
    private readonly notes: AiNotesService,
    private readonly threads: LearningThreadService,
    private readonly chat: ThreadChatService,
    private readonly activity: ActivityService,
    private readonly home: LearningHomeService,
  ) {}

  @Get('home')
  @SchoolRoles('STUDENT')
  getHome(@SchoolUser() user: any) {
    return this.home.getHome(user);
  }

  @Get('mastery')
  @SchoolRoles('STUDENT')
  getMyMastery(@SchoolUser() user: any) {
    return this.mastery.getMyMastery(user);
  }

  @Post('admin/recompute')
  @HttpCode(202)
  @SchoolRoles('INSTITUTE_ADMIN', 'SUPER_ADMIN')
  recompute(@SchoolUser() user: any, @Body() dto: RecomputeMasteryDto) {
    return this.mastery.queueRecompute(user, dto.studentId);
  }

  // Quizzes and assessments are created by opening a thread step; these resume, autosave and submit them.

  @Get('quiz-instances/:id')
  @SchoolRoles('STUDENT')
  getQuiz(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.quiz.getInstance(user, id);
  }

  @Patch('quiz-instances/:id/draft')
  @SchoolRoles('STUDENT')
  saveQuizDraft(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuizAnswersDto) {
    return this.quiz.saveDraft(user, id, dto.answers);
  }

  @Post('quiz-instances/:id/submit')
  @HttpCode(200)
  @SchoolRoles('STUDENT')
  submitQuiz(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuizAnswersDto) {
    return this.quiz.submit(user, id, dto.answers);
  }

  // ── Threads: one chat per mind-map node ──

  @Get('threads')
  @SchoolRoles('STUDENT')
  listThreads(@SchoolUser() user: any) {
    return this.threads.listThreads(user);
  }

  @Post('threads')
  @HttpCode(200)
  @SchoolRoles('STUDENT')
  openThread(@SchoolUser() user: any, @Body() dto: OpenThreadDto) {
    return this.threads.openThread(user, dto);
  }

  @Get('threads/:id')
  @SchoolRoles('STUDENT')
  getThread(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Query() query: ThreadPageQueryDto) {
    return this.threads.getThread(user, id, query.before);
  }

  @Post('threads/:id/messages')
  @SchoolRoles('STUDENT')
  postMessage(@SchoolUser() user: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostThreadMessageDto) {
    return this.chat.postMessage(user, id, dto.text, dto.mode);
  }

  @Post('threads/:id/messages/:messageId/quiz-result')
  @HttpCode(200)
  @SchoolRoles('STUDENT')
  saveChatQuizResult(
    @SchoolUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: SaveChatQuizResultDto,
  ) {
    return this.chat.saveQuizResult(user, id, messageId, dto.answers);
  }

  @Post('threads/:id/steps/:stepId/open')
  @HttpCode(200)
  @SchoolRoles('STUDENT')
  openStep(
    @SchoolUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: OpenStepDto,
  ) {
    return this.threads.openStep(user, id, stepId, dto);
  }

  @Patch('threads/:id/steps/:stepId/progress')
  @SchoolRoles('STUDENT')
  stepProgress(
    @SchoolUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: StepProgressDto,
  ) {
    return this.threads.updateStepProgress(user, id, stepId, dto);
  }

  // ── Engagement ──

  /** Every ~15 s while the page is in use; the last one is sent with fetch(..., { keepalive: true }) on page hide. */
  @Post('activity/heartbeat')
  @HttpCode(200)
  @SchoolRoles('STUDENT')
  heartbeat(@SchoolUser() user: any, @Body() dto: HeartbeatDto) {
    return this.activity.recordHeartbeat(user, dto);
  }

  @Get('engagement/me')
  @SchoolRoles('STUDENT')
  myEngagement(@SchoolUser() user: any) {
    return this.activity.getMyEngagement(user);
  }

  @Get('notes/:sessionId')
  @SchoolRoles('STUDENT')
  getNotes(@SchoolUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.notes.getNotes(user, sessionId);
  }

  @Patch('notes/:sessionId')
  @SchoolRoles('STUDENT')
  saveNotes(@SchoolUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: SaveNotesDto) {
    return this.notes.saveNotes(user, sessionId, dto);
  }
}
