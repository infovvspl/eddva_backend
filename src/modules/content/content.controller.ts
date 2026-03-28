import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe,
    UploadedFile,
    UseInterceptors,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
} from '@nestjs/swagger';

import { ContentService } from './content.service';

import { CreateSubjectDto, UpdateSubjectDto, SubjectQueryDto } from './dto/subject.dto';
import { CreateChapterDto, UpdateChapterDto, ChapterQueryDto } from './dto/chapter.dto';
import { CreateTopicDto, UpdateTopicDto, TopicQueryDto } from './dto/topic.dto';
import {
    CreateQuestionDto,
    UpdateQuestionDto,
    QuestionQueryDto,
    BulkCreateQuestionDto,
} from './dto/question.dto';
import {
    CreateLectureDto,
    UpdateLectureDto,
    LectureQueryDto,
    UpsertProgressDto,
    ProgressQueryDto,
    SaveQuizCheckpointsDto,
    SubmitQuizResponseDto,
} from './dto/lecture.dto';
import { AskAiQuestionDto, CompleteAiStudyDto, CompleteAiQuizDto } from './dto/ai-study.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('Content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('content')
export class ContentController {
    constructor(private readonly contentService: ContentService) { }

    // ─── SUBJECTS ─────────────────────────────────────────────────────────────

    @Post('subjects')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Create a new subject (scoped to tenant)' })
    createSubject(@Body() dto: CreateSubjectDto, @TenantId() tenantId: string) {
        return this.contentService.createSubject(dto, tenantId);
    }

    @Get('subjects')
    @ApiOperation({ summary: 'Get all subjects for this tenant with nested chapters & topics' })
    getSubjects(@Query() query: SubjectQueryDto, @TenantId() tenantId: string) {
        return this.contentService.getSubjects(query, tenantId);
    }

    @Get('subjects/:id')
    @ApiOperation({ summary: 'Get one subject with full chapter+topic tree' })
    @ApiParam({ name: 'id', type: 'string' })
    getSubjectById(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getSubjectById(id, tenantId);
    }

    @Patch('subjects/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a subject' })
    @ApiParam({ name: 'id', type: 'string' })
    updateSubject(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateSubjectDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateSubject(id, dto, tenantId);
    }

    @Delete('subjects/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft delete a subject' })
    @ApiParam({ name: 'id', type: 'string' })
    deleteSubject(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteSubject(id, tenantId);
    }

    // ─── CHAPTERS ─────────────────────────────────────────────────────────────

    @Post('chapters')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Create a chapter under a subject' })
    createChapter(@Body() dto: CreateChapterDto, @TenantId() tenantId: string) {
        return this.contentService.createChapter(dto, tenantId);
    }

    @Get('chapters')
    @ApiOperation({ summary: 'Get chapters for a subject (sorted by sortOrder)' })
    getChapters(@Query() query: ChapterQueryDto, @TenantId() tenantId: string) {
        return this.contentService.getChapters(query.subjectId, tenantId);
    }

    @Patch('chapters/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a chapter' })
    @ApiParam({ name: 'id', type: 'string' })
    updateChapter(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateChapterDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateChapter(id, dto, tenantId);
    }

    @Delete('chapters/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft delete a chapter' })
    @ApiParam({ name: 'id', type: 'string' })
    deleteChapter(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteChapter(id, tenantId);
    }

    // ─── TOPICS ───────────────────────────────────────────────────────────────

    @Post('topics')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Create a topic under a chapter' })
    createTopic(@Body() dto: CreateTopicDto, @TenantId() tenantId: string) {
        return this.contentService.createTopic(dto, tenantId);
    }

    @Get('topics')
    @ApiOperation({ summary: 'Get topics for a chapter' })
    getTopics(@Query() query: TopicQueryDto, @TenantId() tenantId: string) {
        return this.contentService.getTopics(query.chapterId, tenantId);
    }

    @Patch('topics/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.TEACHER, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a topic' })
    @ApiParam({ name: 'id', type: 'string' })
    updateTopic(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateTopicDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateTopic(id, dto, tenantId);
    }

    @Delete('topics/:id')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft delete a topic' })
    @ApiParam({ name: 'id', type: 'string' })
    deleteTopic(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteTopic(id, tenantId);
    }

    // ─── QUESTIONS ────────────────────────────────────────────────────────────

    @Post('questions/bulk')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Bulk create up to 100 questions in one transaction' })
    bulkCreateQuestions(
        @Body() dto: BulkCreateQuestionDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.bulkCreateQuestions(dto, tenantId);
    }

    @Post('questions')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Create a question with options (transactional)' })
    createQuestion(@Body() dto: CreateQuestionDto, @TenantId() tenantId: string) {
        return this.contentService.createQuestion(dto, tenantId);
    }

    @Get('questions')
    @ApiOperation({ summary: 'Paginated list of questions (filterable)' })
    getQuestions(@Query() query: QuestionQueryDto, @TenantId() tenantId: string) {
        return this.contentService.getQuestions(query, tenantId);
    }

    @Get('questions/:id')
    @ApiOperation({ summary: 'Get one question with options and topic' })
    @ApiParam({ name: 'id', type: 'string' })
    getQuestionById(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getQuestionById(id, tenantId);
    }

    @Patch('questions/:id')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a question (replaces all options if provided)' })
    @ApiParam({ name: 'id', type: 'string' })
    updateQuestion(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateQuestionDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateQuestion(id, dto, tenantId);
    }

    @Delete('questions/:id')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft delete a question' })
    @ApiParam({ name: 'id', type: 'string' })
    deleteQuestion(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteQuestion(id, tenantId);
    }

    // ─── LECTURES ─────────────────────────────────────────────────────────────

    // ─── VIDEO UPLOAD ──────────────────────────────────────────────────────────

    @Post('lectures/upload-video')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
    @ApiOperation({ summary: 'Upload a video file; returns the public URL to use as videoUrl' })
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: (_req, _file, cb) => {
                const dest = join(__dirname, '..', '..', '..', 'uploads', 'videos');
                mkdirSync(dest, { recursive: true });
                cb(null, dest);
            },
            filename: (_req, file, cb) => {
                const unique = randomBytes(12).toString('hex');
                cb(null, `${unique}${extname(file.originalname)}`);
            },
        }),
        limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
        fileFilter: (_req, file, cb) => {
            if (!file.mimetype.startsWith('video/')) {
                return cb(new BadRequestException('Only video files are allowed'), false);
            }
            cb(null, true);
        },
    }))
    uploadVideo(
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const url = `/uploads/videos/${file.filename}`;
        return { url, filename: file.filename, size: file.size, mimetype: file.mimetype };
    }

    @Post('lectures')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
    @ApiOperation({ summary: 'Create a lecture (recorded or live)' })
    createLecture(
        @Body() dto: CreateLectureDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        const isAdmin = user.role === UserRole.INSTITUTE_ADMIN || user.role === UserRole.SUPER_ADMIN;
        return this.contentService.createLecture(dto, user.id, tenantId, isAdmin);
    }

    @Get('lectures')
    @ApiOperation({ summary: 'List lectures (role-filtered: student=enrolled batches; teacher=own; admin=all)' })
    getLectures(
        @Query() query: LectureQueryDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getLectures(query, user.id, user.role, tenantId);
    }

    @Get('lectures/:id')
    @ApiOperation({ summary: 'Get one lecture with topic and batch' })
    @ApiParam({ name: 'id', type: 'string' })
    getLectureById(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getLectureById(id, tenantId);
    }

    @Patch('lectures/:id')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a lecture (teachers: own only; admin: any)' })
    @ApiParam({ name: 'id', type: 'string' })
    updateLecture(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateLectureDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateLecture(id, dto, user.id, user.role, tenantId);
    }

    @Delete('lectures/:id')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft delete a lecture' })
    @ApiParam({ name: 'id', type: 'string' })
    deleteLecture(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteLecture(id, user.id, user.role, tenantId);
    }

    // ─── LECTURE PROGRESS ─────────────────────────────────────────────────────

    @Post('lectures/:id/progress')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Upsert watch progress for a lecture (student only)' })
    @ApiParam({ name: 'id', type: 'string' })
    upsertProgress(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpsertProgressDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.upsertProgress(id, dto, user.id, tenantId);
    }

    @Get('lectures/:id/progress')
    @ApiOperation({ summary: "Get a student's progress on a lecture" })
    @ApiParam({ name: 'id', type: 'string' })
    getProgress(
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: ProgressQueryDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getProgress(id, user.id, user.role, tenantId, query.studentId);
    }

    @Get('lectures/:id/stats')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Lecture stats: watch counts, completion rate, confusion hotspots' })
    @ApiParam({ name: 'id', type: 'string' })
    getLectureStats(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getLectureStats(id, tenantId);
    }

    // ─── QUIZ CHECKPOINTS ─────────────────────────────────────────────────────

    @Put('lectures/:id/quiz-checkpoints')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Save AI-generated quiz checkpoints for a lecture (teacher)' })
    @ApiParam({ name: 'id', type: 'string' })
    saveQuizCheckpoints(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: SaveQuizCheckpointsDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.saveQuizCheckpoints(id, dto.questions, user.id, tenantId);
    }

    @Get('lectures/:id/quiz-checkpoints')
    @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
    @ApiOperation({ summary: 'Get quiz checkpoints for a lecture' })
    @ApiParam({ name: 'id', type: 'string' })
    getQuizCheckpoints(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getQuizCheckpoints(id, tenantId);
    }

    @Post('lectures/:id/quiz-response')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Student submits answer to an in-video quiz question' })
    @ApiParam({ name: 'id', type: 'string' })
    submitQuizResponse(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: SubmitQuizResponseDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.submitQuizResponse(id, dto, user.id, tenantId);
    }

    @Get('lectures/:id/watch-analytics')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
    @ApiOperation({ summary: 'Teacher views per-student watch progress and quiz scores' })
    @ApiParam({ name: 'id', type: 'string' })
    getWatchAnalytics(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getWatchAnalytics(id, tenantId);
    }

    // ─── AI STUDY ─────────────────────────────────────────────────────────────

    @Get('topics/:topicId/study-status')
    @Roles(UserRole.STUDENT)
    @ApiOperation({ summary: 'Check if a teacher lecture exists for this topic and whether student has an AI session' })
    @ApiParam({ name: 'topicId', type: 'string' })
    getStudyStatus(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getStudyStatus(topicId, user.id, tenantId);
    }

    @Get('topics/:topicId/ai-study/session')
    @Roles(UserRole.STUDENT)
    @ApiOperation({ summary: 'Get existing AI study session for a topic (to resume)' })
    @ApiParam({ name: 'topicId', type: 'string' })
    getAiStudySession(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getAiStudySession(topicId, user.id, tenantId);
    }

    @Post('topics/:topicId/ai-study/start')
    @Roles(UserRole.STUDENT)
    @ApiOperation({ summary: 'Start (or resume) an AI self-study session for a topic' })
    @ApiParam({ name: 'topicId', type: 'string' })
    startAiStudy(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.startAiStudy(topicId, user.id, tenantId);
    }

    @Post('topics/:topicId/ai-study/:sessionId/ask')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Ask a follow-up question in an AI study session' })
    @ApiParam({ name: 'topicId', type: 'string' })
    @ApiParam({ name: 'sessionId', type: 'string' })
    askAiQuestion(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Body() dto: AskAiQuestionDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.askAiQuestion(topicId, sessionId, dto, user.id, tenantId);
    }

    @Patch('topics/:topicId/ai-study/:sessionId/complete')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark AI study session as complete — awards XP and unlocks quiz' })
    @ApiParam({ name: 'topicId', type: 'string' })
    @ApiParam({ name: 'sessionId', type: 'string' })
    completeAiStudy(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Body() dto: CompleteAiStudyDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.completeAiStudy(topicId, sessionId, dto, user.id, tenantId);
    }

    // ─── AI QUIZ ──────────────────────────────────────────────────────────────

    @Post('topics/:topicId/ai-quiz/generate')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Generate AI quiz questions for a topic (no teacher quiz required)' })
    @ApiParam({ name: 'topicId', type: 'string' })
    generateAiQuiz(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.generateAiQuiz(topicId, user.id, tenantId);
    }

    @Post('topics/:topicId/ai-quiz/complete')
    @Roles(UserRole.STUDENT)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Submit AI quiz result — updates topic progress and awards XP if passed' })
    @ApiParam({ name: 'topicId', type: 'string' })
    completeAiQuiz(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Body() dto: CompleteAiQuizDto,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.completeAiQuiz(topicId, dto, user.id, tenantId);
    }
}
