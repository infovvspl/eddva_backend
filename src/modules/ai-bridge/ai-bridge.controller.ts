import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AiBridgeService } from './ai-bridge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AiFeatureGuard } from '../../common/guards/ai-feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiFeature } from '../../common/decorators/ai-feature.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { UserRole } from '../../database/entities/user.entity';
import {
  ResolveDoubtDirectDto,
  StartTutorSessionDto,
  ContinueTutorSessionDto,
  RecommendContentDto,
  GenerateLectureNotesDto,
  GenerateFeedbackDto,
  AnalyzeNotesDto,
  AnalyzeResumeDto,
  StartInterviewPrepDto,
  GenerateStudyPlanDto,
} from './dto/ai-bridge.dto';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard, AiFeatureGuard)
export class AiBridgeController {
  constructor(private readonly aiBridgeService: AiBridgeService) {}

  // ── AI #1 — Doubt Clearing ────────────────────────────────────────────────
  @Post('doubt/resolve')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @AiFeature('ai_doubt_resolution')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new BadRequestException('Only image files are allowed'), false);
        cb(null, true);
      },
    }),
  )
  async resolveDoubt(
    @Body() body: ResolveDoubtDirectDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.resolveDoubt(
      {
        questionText: body.question || body.questionText || '',
        topicId: body.topicId,
        mode: (body.mode as 'short' | 'detailed') || 'detailed',
        studentContext: { userId },
        questionImageUrl: image
          ? `data:${image.mimetype};base64,${image.buffer.toString('base64')}`
          : undefined,
      },
      tenantId,
    );
  }

  // ── AI #2 — AI Tutor ──────────────────────────────────────────────────────
  @Post('tutor/session')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_study_assistant')
  @HttpCode(HttpStatus.OK)
  async startTutorSession(
    @Body() dto: StartTutorSessionDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Headers('x-vertical') vertical?: string,
  ) {
    return this.aiBridgeService.startTutorSession(
      { studentId: userId, topicId: dto.topicId, context: dto.context || '' },
      tenantId,
      vertical,
    );
  }

  @Post('tutor/continue')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_study_assistant')
  @HttpCode(HttpStatus.OK)
  async continueTutorSession(
    @Body() dto: ContinueTutorSessionDto,
    @TenantId() tenantId: string,
    @Headers('x-vertical') vertical?: string,
  ) {
    return this.aiBridgeService.continueTutorSession(
      { sessionId: dto.sessionId, studentMessage: dto.studentMessage },
      tenantId,
      vertical,
    );
  }

  // ── AI #3 — Content Recommendation ───────────────────────────────────────
  @Post('content/recommend')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_analytics')
  @HttpCode(HttpStatus.OK)
  async recommendContent(
    @Body() dto: RecommendContentDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.getContentRecommendations(
      { studentId: userId, context: dto.context, weakTopics: dto.weakTopics, recentPerformance: dto.recentPerformance },
      tenantId,
    );
  }

  // ── AI #4 — Speech-to-Text Notes ─────────────────────────────────────────
  @Post('stt/notes')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @AiFeature('ai_speech_to_text')
  @HttpCode(HttpStatus.OK)
  async generateLectureNotes(@Body() dto: GenerateLectureNotesDto, @TenantId() tenantId: string) {
    const audioUrl = this._fixAudioUrl(dto.audioUrl);
    return this.aiBridgeService.generateLectureNotes({ audioUrl, topicId: dto.topicId || '', language: dto.language || 'en' }, tenantId);
  }

  // ── AI #5 — Student Feedback ──────────────────────────────────────────────
  @Post('feedback/generate')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  @AiFeature('ai_analytics')
  @HttpCode(HttpStatus.OK)
  async generateFeedback(
    @Body() dto: GenerateFeedbackDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateFeedback({ studentId: userId, context: dto.context, data: dto.data }, tenantId);
  }

  // ── AI #6 — Notes Weak Topic Identifier ──────────────────────────────────
  @Post('notes/analyze')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_analytics')
  @HttpCode(HttpStatus.OK)
  async analyzeNotes(
    @Body() dto: AnalyzeNotesDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.analyzeNotes({ studentId: userId, notesContent: dto.notesContent, topicId: dto.topicId || '' }, tenantId);
  }

  // ── AI #7 — Resume Analyzer ───────────────────────────────────────────────
  @Post('resume/analyze')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_analytics')
  @HttpCode(HttpStatus.OK)
  async analyzeResume(@Body() dto: AnalyzeResumeDto, @TenantId() tenantId: string) {
    return this.aiBridgeService.analyzeResume({ resumeText: dto.resumeText, targetRole: dto.targetRole || 'Software Engineer' }, tenantId);
  }

  // ── AI #8 — Interview Prep ────────────────────────────────────────────────
  @Post('interview/start')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_study_assistant')
  @HttpCode(HttpStatus.OK)
  async startInterviewPrep(
    @Body() dto: StartInterviewPrepDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.startInterviewPrep({ studentId: userId, targetCollege: dto.targetCollege || 'IIT' }, tenantId);
  }

  // ── AI #9 — Personalized Study Plan ──────────────────────────────────────
  @Post('plan/generate')
  @Roles(UserRole.STUDENT)
  @AiFeature('ai_study_plan')
  @HttpCode(HttpStatus.OK)
  async generateStudyPlan(
    @Body() dto: GenerateStudyPlanDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateStudyPlan(
      { studentId: userId, examTarget: dto.examTarget, examYear: dto.examYear, dailyHours: dto.dailyHours, weakTopics: dto.weakTopics || [], targetCollege: dto.targetCollege, academicCalendar: dto.academicCalendar },
      tenantId,
    );
  }

  // ── AI #10 — Question Generator (teacher/admin) ───────────────────────────
  @Post('questions/generate')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @AiFeature('ai_content_generation')
  @HttpCode(HttpStatus.OK)
  async generateQuestionsFromTopic(
    @Body() body: { topicId: string; topicName: string; count?: number; difficulty?: string; type?: string; style?: string; examTarget?: string; subject?: string; chapter?: string; notes?: string | string[]; subjectName?: string; chapterName?: string; language?: string },
    @TenantId() tenantId: string,
  ) {
    console.log('[AI Bridge Controller] Incoming request language:', body.language);
    return this.aiBridgeService.generateQuestionsFromTopic(
      { topicId: body.topicId, topicName: body.topicName, count: body.count || 10, difficulty: body.difficulty || 'medium', type: body.type || 'mcq_single', style: body.style, examTarget: body.examTarget, subject: body.subject, chapter: body.chapter, notes: body.notes, language: body.language },
      tenantId,
    );
  }

  // ── AI Engine Health (no feature gate — admin diagnostic) ─────────────────
  @Get('engine/health')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAiEngineHealth(@Query('refresh') refresh: string, @TenantId() tenantId: string) {
    return this.aiBridgeService.getAiEngineHealth(refresh === 'true', tenantId);
  }

  // ── AI #11 — In-Video Quiz Generator ─────────────────────────────────────
  @Post('quiz/generate')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @AiFeature('ai_content_generation')
  @HttpCode(HttpStatus.OK)
  async generateQuizForLecture(
    @Body() dto: { notes?: string; transcript?: string; lectureTitle?: string; topicId?: string; numQuestions?: number; courseLevel?: string; language?: 'en' | 'hi' | 'hinglish' | 'od' },
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateQuizForLecture(
      { notes: dto.notes || '', transcript: dto.transcript || '', lectureTitle: dto.lectureTitle || 'Lecture', topicId: dto.topicId || '', numQuestions: dto.numQuestions ?? 5, courseLevel: dto.courseLevel, language: dto.language || 'en' },
      tenantId,
    );
  }

  private _fixAudioUrl(url: string): string {
    const doubleUrl = url.match(/https?:\/\/[^/]+\/api\/v\d+(https?:\/\/.+)/);
    if (doubleUrl) return doubleUrl[1];
    return url.replace(/\/api\/v\d+\/uploads\//, '/uploads/');
  }
}
