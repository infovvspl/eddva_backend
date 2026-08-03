import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolStudyPlanService } from './school-study-plan.service';
import {
  AskAiQuestionDto,
  CompleteAiStudyDto,
  CompleteAiQuizDto,
  UpdateAiStudyNotesDto,
} from './school-ai-study.dto';

@Controller('school')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('ai', 'ai_study_planner')
export class SchoolAiStudyController {
  constructor(private readonly service: SchoolStudyPlanService) { }

  @Get('topics/:topicId/study-status')
  getStudyStatus(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.service.getStudyStatus(user, topicId);
  }

  @Get('ai-study/history')
  getAiStudyHistory(@SchoolUser() user: any) {
    return this.service.getAiStudyHistory(user);
  }

  @Get('topics/:topicId/ai-study/session')
  getAiStudySession(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.service.getAiStudySession(user, topicId);
  }

  @Post('topics/:topicId/ai-study/start')
  startAiStudy(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.service.startAiStudy(user, topicId);
  }

  @Post('topics/:topicId/ai-study/:sessionId/ask')
  askAiQuestion(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AskAiQuestionDto,
  ) {
    return this.service.askAiQuestion(user, topicId, sessionId, dto.question);
  }

  @Patch('topics/:topicId/ai-study/:sessionId/complete')
  completeAiStudy(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CompleteAiStudyDto,
  ) {
    return this.service.completeAiStudy(user, topicId, sessionId, dto);
  }

  @Patch('topics/:topicId/ai-study/:sessionId/save-notes')
  saveAiStudyNotes(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateAiStudyNotesDto,
  ) {
    return this.service.saveAiStudyNotes(user, topicId, sessionId, dto);
  }

  @Post('topics/:topicId/ai-quiz/generate')
  generateAiQuiz(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
  ) {
    return this.service.generateAiQuiz(user, topicId);
  }

  @Post('topics/:topicId/ai-quiz/complete')
  completeAiQuiz(
    @SchoolUser() user: any,
    @Param('topicId', ParseUUIDPipe) topicId: string,
    @Body() dto: CompleteAiQuizDto,
  ) {
    return this.service.completeAiQuiz(user, topicId, dto);
  }
}
