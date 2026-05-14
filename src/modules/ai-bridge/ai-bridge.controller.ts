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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AiBridgeService } from './ai-bridge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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

/**
 * AiBridgeController
 *
 * Exposes ALL 12 AI services as REST endpoints for frontend integration testing.
 * These endpoints mirror what the domain modules (doubt, study-plan) do internally,
 * but are directly accessible for E2E testing before frontend integration.
 *
 * Flow: Frontend → NestJS (JWT auth) → Django AI (Bearer + X-Tenant-ID) → LLM
 *
 * All endpoints require JWT authentication. Most are STUDENT-only.
 * Teachers can access grading and engagement endpoints.
 */
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiBridgeController {
  constructor(private readonly aiBridgeService: AiBridgeService) {}

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #1 — Doubt Clearing (2-step: detect → subject-specific solver)
  //  Accepts multipart/form-data with optional `image` file field,
  //  or application/json with optional `questionImageBase64` data URL.
  // ══════════════════════════════════════════════════════════════════════════
  @Post('doubt/resolve')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
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
    return this.aiBridgeService.resolveDoubtDirect(
      {
        question: body.question || body.questionText || '',
        topicId: body.topicId,
        mode: body.mode || 'detailed',
        studentContext: { userId },
      },
      image,
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #2 — AI Tutor
  // ══════════════════════════════════════════════════════════════════════════
  @Post('tutor/session')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async startTutorSession(
    @Body() dto: StartTutorSessionDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.startTutorSession(
      {
        studentId: userId,
        topicId: dto.topicId,
        context: dto.context || '',
      },
      tenantId,
    );
  }

  @Post('tutor/continue')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async continueTutorSession(
    @Body() dto: ContinueTutorSessionDto,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.continueTutorSession(
      {
        sessionId: dto.sessionId,
        studentMessage: dto.studentMessage,
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #6 — Content Recommendation
  // ══════════════════════════════════════════════════════════════════════════
  @Post('content/recommend')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async recommendContent(
    @Body() dto: RecommendContentDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.getContentRecommendations(
      {
        studentId: userId,
        context: dto.context,
        weakTopics: dto.weakTopics,
        recentPerformance: dto.recentPerformance,
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #7 — Speech-to-Text Notes
  // ══════════════════════════════════════════════════════════════════════════
  @Post('stt/notes')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateLectureNotes(
    @Body() dto: GenerateLectureNotesDto,
    @TenantId() tenantId: string,
  ) {
    const audioUrl = this._fixAudioUrl(dto.audioUrl);
    return this.aiBridgeService.generateLectureNotes(
      {
        audioUrl,
        topicId: dto.topicId || '',
        language: dto.language || 'en',
      },
      tenantId,
    );
  }

  private _fixAudioUrl(url: string): string {
    const doubleUrl = url.match(/https?:\/\/[^/]+\/api\/v\d+(https?:\/\/.+)/);
    if (doubleUrl) return doubleUrl[1];
    return url.replace(/\/api\/v\d+\/uploads\//, '/uploads/');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #8 — Student Feedback Engine
  // ══════════════════════════════════════════════════════════════════════════
  @Post('feedback/generate')
  @Roles(UserRole.STUDENT, UserRole.TEACHER)
  @HttpCode(HttpStatus.OK)
  async generateFeedback(
    @Body() dto: GenerateFeedbackDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateFeedback(
      {
        studentId: userId,
        context: dto.context,
        data: dto.data,
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #9 — Notes Weak Topic Identifier
  // ══════════════════════════════════════════════════════════════════════════
  @Post('notes/analyze')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async analyzeNotes(
    @Body() dto: AnalyzeNotesDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.analyzeNotes(
      {
        studentId: userId,
        notesContent: dto.notesContent,
        topicId: dto.topicId || '',
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #10 — Resume Analyzer
  // ══════════════════════════════════════════════════════════════════════════
  @Post('resume/analyze')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async analyzeResume(
    @Body() dto: AnalyzeResumeDto,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.analyzeResume(
      {
        resumeText: dto.resumeText,
        targetRole: dto.targetRole || 'Software Engineer',
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #11 — Interview Prep
  // ══════════════════════════════════════════════════════════════════════════
  @Post('interview/start')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async startInterviewPrep(
    @Body() dto: StartInterviewPrepDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.startInterviewPrep(
      {
        studentId: userId,
        targetCollege: dto.targetCollege || 'IIT',
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #12 — Personalized Study Plan
  //  (Also available via POST /study-plans/generate — this is for direct testing)
  // ══════════════════════════════════════════════════════════════════════════
  @Post('plan/generate')
  @Roles(UserRole.STUDENT)
  @HttpCode(HttpStatus.OK)
  async generateStudyPlan(
    @Body() dto: GenerateStudyPlanDto,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateStudyPlan(
      {
        studentId: userId,
        examTarget: dto.examTarget,
        examYear: dto.examYear,
        dailyHours: dto.dailyHours,
        weakTopics: dto.weakTopics || [],
        targetCollege: dto.targetCollege,
        academicCalendar: dto.academicCalendar,
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #13 — Quiz Question Generator from Topic (for quiz builder)
  // ══════════════════════════════════════════════════════════════════════════
  @Post('questions/generate')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateQuestionsFromTopic(
    @Body() body: {
      topicId: string;
      topicName: string;
      count?: number;
      difficulty?: string;
      type?: string;
      style?: string;
      examTarget?: string;
      subject?: string;
      chapter?: string;
      notes?: string | string[];
      subjectName?: string;
      chapterName?: string;
    },
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateQuestionsFromTopic(
      {
        topicId: body.topicId,
        topicName: body.topicName,
        count: body.count || 10,
        difficulty: body.difficulty || 'medium',
        type: body.type || 'mcq_single',
        style: body.style,
        examTarget: body.examTarget,
        subject: body.subject,
        chapter: body.chapter,
        notes: body.notes,
        subjectName: body.subjectName,
        chapterName: body.chapterName,
      },
      tenantId,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI Engine Health — teacher/admin only
  // ══════════════════════════════════════════════════════════════════════════
  @Get('engine/health')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAiEngineHealth(
    @Query('refresh') refresh: string,
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.getAiEngineHealth(refresh === 'true', tenantId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  AI #14 — In-Video Quiz Generator
  // ══════════════════════════════════════════════════════════════════════════
  @Post('quiz/generate')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async generateQuizForLecture(
    @Body() dto: { notes?: string; transcript?: string; lectureTitle?: string; topicId?: string; numQuestions?: number; courseLevel?: string },
    @TenantId() tenantId: string,
  ) {
    return this.aiBridgeService.generateQuizForLecture(
      {
        notes: dto.notes || '',
        transcript: dto.transcript || '',
        lectureTitle: dto.lectureTitle || 'Lecture',
        topicId: dto.topicId || '',
        numQuestions: dto.numQuestions ?? 5,
        courseLevel: dto.courseLevel,
      },
      tenantId,
    );
  }
}
