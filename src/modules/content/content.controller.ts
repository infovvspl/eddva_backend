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
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe,
    BadRequestException,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';

import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, createReadStream, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

import { memoryStorage } from 'multer';
import {
    ApiTags,
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiConsumes,
} from '@nestjs/swagger';

import { ContentService } from './content.service';

import { CreateSubjectDto, UpdateSubjectDto, SubjectQueryDto } from './dto/subject.dto';

const MAX_LECTURE_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOPIC_RESOURCE_UPLOAD_BYTES = 100 * 1024 * 1024;
import { BulkImportCurriculumDto } from './dto/bulk-import.dto';
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
import { S3Service } from '../upload/s3.service';

@ApiTags('Content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('content')
export class ContentController {
    constructor(
        private readonly contentService: ContentService,
        private readonly s3Service: S3Service,
    ) { }

    // ─── BULK IMPORT ─────────────────────────────────────────────────────────

    @Post('curriculum/bulk-import')
    @Roles(UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
    @ApiOperation({ summary: 'Bulk import subjects → chapters → topics for a batch in one shot' })
    bulkImportCurriculum(
        @Body() dto: BulkImportCurriculumDto,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.bulkImportCurriculum(dto, tenantId);
    }

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

    // ─── VIDEO UPLOAD (browser → API → S3) ────────────────────────────────────
    // Multipart upload avoids S3 bucket CORS for dev origins (e.g. cds.localhost).
    // Optional body fields courseId + lectureId match the presigned key layout from POST /upload-url.

    @Post('lectures/upload-video')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Upload a lecture video through backend to S3' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    const dir = join(tmpdir(), 'eddva-lecture-uploads');
                    mkdirSync(dir, { recursive: true });
                    cb(null, dir);
                },
                filename: (_req, file, cb) => {
                    const ext = extname(file.originalname).toLowerCase() || '.mp4';
                    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
                },
            }),
            limits: { fileSize: MAX_LECTURE_VIDEO_UPLOAD_BYTES }, // 2 GB — temp file on disk, streamed to S3
            fileFilter: (_req, file, cb) => {
                if (!file.mimetype.startsWith('video/') && !file.mimetype.startsWith('audio/')) {
                    return cb(new BadRequestException('Only video or audio files are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadVideo(
        @UploadedFile() file: Express.Multer.File,
        @Body('courseId') courseId: string | undefined,
        @Body('lectureId') lectureId: string | undefined,
        @TenantId() tenantId: string,
    ) {
        if (!file?.path) throw new BadRequestException('No file uploaded');
        const ext = extname(file.originalname).toLowerCase() || '.mp4';
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || `video${ext}`;
        const objectName = `${Date.now()}-${uuidv4()}-${safeName}`;
        const key =
            courseId && lectureId
                ? `tenants/${tenantId}/courses/${courseId}/lectures/${lectureId}/video/${objectName}`
                : `tenants/${tenantId}/lectures/${objectName}`;

        const stream = createReadStream(file.path);
        try {
            const fileUrl = await this.s3Service.uploadStream(key, stream, file.mimetype);
            return { url: fileUrl };
        } finally {
            try {
                unlinkSync(file.path);
            } catch {
                // ignore
            }
        }
    }

    @Post('lectures/upload-thumbnail')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Upload a lecture thumbnail image to S3' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
            fileFilter: (_req, file, cb) => {
                if (!file.mimetype.startsWith('image/')) {
                    return cb(new BadRequestException('Only image files are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadThumbnail(
        @UploadedFile() file: Express.Multer.File,
        @TenantId() tenantId: string,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        const ext = extname(file.originalname).toLowerCase() || '.jpg';
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || `thumbnail${ext}`;
        const key = `tenants/${tenantId}/lectures/thumbnails/${Date.now()}-${safeName}`;
        const fileUrl = await this.s3Service.upload(key, file.buffer, file.mimetype);
        return { url: fileUrl };
    }

    @Post('lectures/confirm-video')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Confirm video URL after S3 upload (no-op — videoUrl is set on lecture create/update)' })
    confirmVideo(@Body('fileUrl') fileUrl: string) {
        if (!fileUrl) throw new BadRequestException('fileUrl is required');
        return { url: fileUrl };
    }

    @Post('lectures')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
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
        @CurrentUser() user: any,
    ) {
        return this.contentService.getLectureById(id, tenantId, user);
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

    @Post('lectures/:id/translate-transcript')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Translate lecture transcript to Hindi (cached after first call)' })
    @ApiParam({ name: 'id', type: 'string' })
    translateTranscript(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
        @CurrentUser() user: any,
    ) {
        return this.contentService.translateLectureTranscript(id, tenantId, user);
    }

    @Post('lectures/:id/translate-notes')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Translate AI notes to English (on-demand)' })
    @ApiParam({ name: 'id', type: 'string' })
    translateNotesToEnglish(
        @Param('id', ParseUUIDPipe) id: string,
        @TenantId() tenantId: string,
        @CurrentUser() user: any,
    ) {
        return this.contentService.translateLectureNotesToEnglish(id, tenantId, user);
    }

    @Post('lectures/:id/retranscribe')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Re-trigger AI transcription for a recorded lecture' })
    @ApiParam({ name: 'id', type: 'string' })
    retranscribeLecture(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.retranscribeLecture(id, user.id, user.role, tenantId);
    }

    @Post('lectures/:id/regenerate-notes')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Regenerate AI notes from the already-saved transcript (no re-transcription)' })
    @ApiParam({ name: 'id', type: 'string' })
    regenerateNotes(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.regenerateNotes(id, user.id, user.role, tenantId);
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
        return this.contentService.getProgress(id, user, tenantId, query.studentId);
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
        @CurrentUser() user: any,
    ) {
        return this.contentService.getQuizCheckpoints(id, tenantId, user);
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

    // ─── TOPIC RESOURCES (PDF / DPP / QUIZ / NOTES) ───────────────────────────

    // ─── TOPIC RESOURCE (S3 pre-signed flow) ─────────────────────────────────
    // 1. Call POST /upload/url { type:"material", courseId, fileName, contentType, fileSize }
    // 2. PUT file directly to S3 using the returned uploadUrl
    // 3. Call this endpoint with the returned fileUrl + metadata to save the record

    @Post('topics/:topicId/resources/upload')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Save a topic resource after S3 upload' })
    @ApiParam({ name: 'topicId', type: 'string' })
    uploadTopicResource(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Body() body: { title: string; type: string; fileUrl: string; fileSizeKb?: number; description?: string; sortOrder?: number },
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        if (!body.fileUrl) throw new BadRequestException('fileUrl is required');
        return this.contentService.createTopicResource(topicId, {
            title: body.title,
            type: body.type as any,
            description: body.description,
            sortOrder: body.sortOrder ?? 0,
            fileUrl: body.fileUrl,
            fileSizeKb: body.fileSizeKb ?? 0,
            uploadedBy: user.id,
        }, tenantId);
    }

    @Post('topics/:topicId/resources/upload-file')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Upload a topic resource through backend and save the final file URL' })
    @ApiParam({ name: 'topicId', type: 'string' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: MAX_TOPIC_RESOURCE_UPLOAD_BYTES },
            fileFilter: (_req, file, cb) => {
                const allowed =
                    file.mimetype === 'application/pdf' ||
                    file.mimetype.startsWith('image/');

                if (!allowed) {
                    return cb(new BadRequestException('Only PDF or image files are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadTopicResourceFile(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body() body: { title: string; type: string; description?: string; sortOrder?: string; fileSizeKb?: string },
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        if (!body.title) throw new BadRequestException('title is required');
        if (!body.type) throw new BadRequestException('type is required');

        const ext = extname(file.originalname).toLowerCase();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const key = `tenants/${tenantId}/topics/${topicId}/resources/${Date.now()}-${safeName || `resource${ext || ''}`}`;
        const fileUrl = await this.s3Service.upload(key, file.buffer, file.mimetype);

        return this.contentService.createTopicResource(topicId, {
            title: body.title,
            type: body.type as any,
            description: body.description,
            sortOrder: body.sortOrder ? Number(body.sortOrder) : 0,
            fileUrl,
            fileKey: key,
            fileSizeKb: body.fileSizeKb ? Number(body.fileSizeKb) : Math.ceil(file.size / 1024),
            uploadedBy: user.id,
        }, tenantId);
    }

    @Post('topics/:topicId/resources/link')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Add a URL-based resource (YouTube link, external PDF, etc.) for a topic' })
    @ApiParam({ name: 'topicId', type: 'string' })
    addTopicResourceLink(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Body() body: { title: string; type: string; externalUrl: string; description?: string; sortOrder?: number },
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.createTopicResourceByUrl(topicId, {
            title: body.title,
            type: body.type as any,
            externalUrl: body.externalUrl,
            description: body.description,
            sortOrder: body.sortOrder ?? 0,
            uploadedBy: user.id,
        }, tenantId);
    }

    @Get('topics/:topicId/resources/:resourceId/download-url')
    @ApiOperation({ summary: 'Get a presigned download URL for a topic resource file' })
    @ApiParam({ name: 'topicId', type: 'string' })
    @ApiParam({ name: 'resourceId', type: 'string' })
    async getResourceDownloadUrl(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Param('resourceId', ParseUUIDPipe) resourceId: string,
        @TenantId() tenantId: string,
    ) {
        const resource = await this.contentService.getTopicResourceById(resourceId, tenantId);
        if (resource.externalUrl) return { url: resource.externalUrl, type: 'external' };
        if (!resource.fileUrl) return { url: null, type: 'ai-content', content: resource.description };
        const key = this.s3Service.keyFromUrl(resource.fileUrl);
        const url = await this.s3Service.presignDownload(key, resource.title ?? undefined);
        return { url, type: 'file' };
    }

    @Get('topics/:topicId/resources')
    @ApiOperation({ summary: 'List all resources for a topic (PDF, DPP, quiz, notes)' })
    @ApiParam({ name: 'topicId', type: 'string' })
    getTopicResources(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.getTopicResources(topicId, tenantId);
    }

    @Patch('topics/:topicId/resources/:resourceId')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @ApiOperation({ summary: 'Update a topic resource (title, description, sortOrder)' })
    updateTopicResource(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Param('resourceId', ParseUUIDPipe) resourceId: string,
        @Body() body: { title?: string; description?: string; sortOrder?: number; isActive?: boolean },
        @TenantId() tenantId: string,
    ) {
        return this.contentService.updateTopicResource(resourceId, body, tenantId);
    }

    @Delete('topics/:topicId/resources/:resourceId')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a topic resource' })
    deleteTopicResource(
        @Param('resourceId', ParseUUIDPipe) resourceId: string,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.deleteTopicResource(resourceId, tenantId);
    }

    @Post('topics/:topicId/generate-ai-content')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Generate AI content (DPP, notes, PYQ, etc.) for a topic' })
    @ApiParam({ name: 'topicId', type: 'string' })
    generateTopicAiContent(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Body() dto: { contentType: string; difficulty: string; length: string; extraContext?: string },
        @TenantId() tenantId: string,
    ) {
        return this.contentService.generateTopicAiContent(topicId, dto, tenantId);
    }

    @Post('topics/:topicId/save-ai-resource')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Save AI-generated content as a topic resource' })
    @ApiParam({ name: 'topicId', type: 'string' })
    saveAiResource(
        @Param('topicId', ParseUUIDPipe) topicId: string,
        @Body() dto: { title: string; content: string; resourceType?: string },
        @CurrentUser() user: any,
        @TenantId() tenantId: string,
    ) {
        return this.contentService.saveTopicAiResource(topicId, dto, user.id, tenantId);
    }

    // ─── BATCH THUMBNAIL ──────────────────────────────────────────────────────

    // ─── BATCH THUMBNAIL (S3 pre-signed flow) ────────────────────────────────
    // 1. Call POST /upload/url { type:"thumbnail", courseId:batchId, fileName, contentType, fileSize }
    // 2. PUT image directly to S3 using the returned uploadUrl
    // 3. Call this endpoint with the returned fileUrl to save it on the batch

    @Post('batches/:batchId/thumbnail')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Save batch thumbnail after S3 upload' })
    @ApiParam({ name: 'batchId', type: 'string' })
    uploadBatchThumbnail(
        @Param('batchId', ParseUUIDPipe) batchId: string,
        @Body('fileUrl') fileUrl: string,
        @TenantId() tenantId: string,
    ) {
        if (!fileUrl) throw new BadRequestException('fileUrl is required');
        return this.contentService.updateBatchThumbnail(batchId, fileUrl, tenantId);
    }

    @Post('batches/:batchId/thumbnail/upload')
    @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN, UserRole.SUPER_ADMIN)
    @HttpCode(HttpStatus.OK)
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Upload batch thumbnail through backend and save the final URL' })
    @ApiParam({ name: 'batchId', type: 'string' })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter: (_req, file, cb) => {
                if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
                    return cb(new BadRequestException('Only image files are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadBatchThumbnailFile(
        @Param('batchId', ParseUUIDPipe) batchId: string,
        @UploadedFile() file: Express.Multer.File,
        @TenantId() tenantId: string,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');

        const ext = extname(file.originalname).toLowerCase() || '.png';
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const key = `tenants/${tenantId}/courses/${batchId}/thumbnail/${Date.now()}-${safeName || `thumbnail${ext}`}`;
        const fileUrl = await this.s3Service.upload(key, file.buffer, file.mimetype);

        return this.contentService.updateBatchThumbnail(batchId, fileUrl, tenantId);
    }
}
