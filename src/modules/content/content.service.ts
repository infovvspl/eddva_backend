import {
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Like, FindOptionsWhere, In } from 'typeorm';

import { Subject, Chapter, Topic } from '../../database/entities/subject.entity';
import {
    Question,
    QuestionOption,
    QuestionType,
} from '../../database/entities/question.entity';
import {
    Lecture,
    LectureProgress,
    LectureType,
    LectureStatus,
    AiStudySession,
} from '../../database/entities/learning.entity';
import { TopicProgress, TopicStatus, MockTest } from '../../database/entities/assessment.entity';
import { PlanItem, PlanItemStatus, PlanItemType, StudyPlan } from '../../database/entities/learning.entity';
import { Batch, BatchSubjectTeacher, Enrollment } from '../../database/entities/batch.entity';
import { UserRole } from '../../database/entities/user.entity';
import { Student } from '../../database/entities/student.entity';

import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { AskAiQuestionDto, CompleteAiStudyDto, CompleteAiQuizDto } from './dto/ai-study.dto';
import { CreateSubjectDto, UpdateSubjectDto, SubjectQueryDto } from './dto/subject.dto';
import { CreateChapterDto, UpdateChapterDto } from './dto/chapter.dto';
import { CreateTopicDto, UpdateTopicDto } from './dto/topic.dto';
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
} from './dto/lecture.dto';

@Injectable()
export class ContentService {
    private readonly logger = new Logger(ContentService.name);

    constructor(
        @InjectRepository(Subject)
        private readonly subjectRepo: Repository<Subject>,
        @InjectRepository(Chapter)
        private readonly chapterRepo: Repository<Chapter>,
        @InjectRepository(Topic)
        private readonly topicRepo: Repository<Topic>,
        @InjectRepository(Question)
        private readonly questionRepo: Repository<Question>,
        @InjectRepository(QuestionOption)
        private readonly optionRepo: Repository<QuestionOption>,
        @InjectRepository(Lecture)
        private readonly lectureRepo: Repository<Lecture>,
        @InjectRepository(LectureProgress)
        private readonly progressRepo: Repository<LectureProgress>,
        @InjectRepository(Batch)
        private readonly batchRepo: Repository<Batch>,
        @InjectRepository(BatchSubjectTeacher)
        private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
        @InjectRepository(Enrollment)
        private readonly enrollmentRepo: Repository<Enrollment>,
        @InjectRepository(AiStudySession)
        private readonly aiStudyRepo: Repository<AiStudySession>,
        @InjectRepository(TopicProgress)
        private readonly topicProgressRepo: Repository<TopicProgress>,
        @InjectRepository(MockTest)
        private readonly mockTestRepo: Repository<MockTest>,
        @InjectRepository(StudyPlan)
        private readonly studyPlanRepo: Repository<StudyPlan>,
        @InjectRepository(PlanItem)
        private readonly planItemRepo: Repository<PlanItem>,
        private readonly dataSource: DataSource,
        private readonly aiBridgeService: AiBridgeService,
    ) { }

    // ─── SUBJECTS ─────────────────────────────────────────────────────────────

    async createSubject(dto: CreateSubjectDto, tenantId: string): Promise<Subject> {
        this.logger.log(`Creating subject for tenant ${tenantId}`);
        const subject = this.subjectRepo.create({ ...dto, tenantId });
        return this.subjectRepo.save(subject);
    }

    async getSubjects(query: SubjectQueryDto, tenantId: string): Promise<Subject[]> {
        const where: FindOptionsWhere<Subject> = { tenantId, isActive: true };
        if (query.examTarget) where.examTarget = query.examTarget;

        // When a batchId is given, restrict to only subjects assigned to that batch.
        if (query.batchId) {
            const assignments = await this.batchSubjectTeacherRepo.find({
                where: { batchId: query.batchId },
                select: ['subjectName'],
            });
            if (assignments.length === 0) return [];
            const assignedNames = assignments.map(a => a.subjectName.toLowerCase());

            const tenantSubjects = await this.subjectRepo.find({
                where: { tenantId, isActive: true },
                relations: ['chapters', 'chapters.topics'],
                order: { sortOrder: 'ASC', createdAt: 'ASC' },
            });
            return tenantSubjects.filter(s => assignedNames.includes(s.name.toLowerCase()));
        }

        return this.subjectRepo.find({
            where: { tenantId, isActive: true },
            relations: ['chapters', 'chapters.topics'],
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
    }

    async getSubjectById(id: string, tenantId: string): Promise<Subject> {
        const subject = await this.subjectRepo.findOne({
            where: { id, tenantId },
            relations: ['chapters', 'chapters.topics'],
            order: { sortOrder: 'ASC' } as any,
        });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        return subject;
    }

    async updateSubject(id: string, dto: UpdateSubjectDto, tenantId: string): Promise<Subject> {
        this.logger.log(`Updating subject ${id} for tenant ${tenantId}`);
        const subject = await this.subjectRepo.findOne({ where: { id, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        Object.assign(subject, dto);
        return this.subjectRepo.save(subject);
    }

    async deleteSubject(id: string, tenantId: string): Promise<{ message: string }> {
        this.logger.log(`Soft deleting subject ${id} for tenant ${tenantId}`);
        const subject = await this.subjectRepo.findOne({ where: { id, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${id} not found`);
        await this.subjectRepo.softDelete(id);
        return { message: 'Subject deleted successfully' };
    }

    // ─── CHAPTERS ────────────────────────────────────────────────────────────

    async createChapter(dto: CreateChapterDto, tenantId: string): Promise<Chapter> {
        this.logger.log(`Creating chapter for subject ${dto.subjectId}, tenant ${tenantId}`);
        // Validate parent subject belongs to this tenant
        const subject = await this.subjectRepo.findOne({ where: { id: dto.subjectId, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${dto.subjectId} not found`);

        const chapter = this.chapterRepo.create({ ...dto, tenantId });
        return this.chapterRepo.save(chapter);
    }

    async getChapters(subjectId: string, tenantId: string): Promise<Chapter[]> {
        const subject = await this.subjectRepo.findOne({ where: { id: subjectId, tenantId } });
        if (!subject) throw new NotFoundException(`Subject ${subjectId} not found`);

        return this.chapterRepo.find({
            where: { subjectId, tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
    }

    async updateChapter(id: string, dto: UpdateChapterDto, tenantId: string): Promise<Chapter> {
        const chapter = await this.chapterRepo.findOne({ where: { id, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
        Object.assign(chapter, dto);
        return this.chapterRepo.save(chapter);
    }

    async deleteChapter(id: string, tenantId: string): Promise<{ message: string }> {
        const chapter = await this.chapterRepo.findOne({ where: { id, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${id} not found`);
        await this.chapterRepo.softDelete(id);
        return { message: 'Chapter deleted successfully' };
    }

    // ─── TOPICS ──────────────────────────────────────────────────────────────

    async createTopic(dto: CreateTopicDto, tenantId: string): Promise<Topic> {
        this.logger.log(`Creating topic for chapter ${dto.chapterId}, tenant ${tenantId}`);
        const chapter = await this.chapterRepo.findOne({ where: { id: dto.chapterId, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${dto.chapterId} not found`);

        const topic = this.topicRepo.create({ ...dto, tenantId });
        return this.topicRepo.save(topic);
    }

    async getTopics(chapterId: string, tenantId: string): Promise<Topic[]> {
        const chapter = await this.chapterRepo.findOne({ where: { id: chapterId, tenantId } });
        if (!chapter) throw new NotFoundException(`Chapter ${chapterId} not found`);

        return this.topicRepo.find({
            where: { chapterId, tenantId, isActive: true },
            order: { sortOrder: 'ASC', createdAt: 'ASC' },
        });
    }

    async updateTopic(id: string, dto: UpdateTopicDto, tenantId: string): Promise<Topic> {
        const topic = await this.topicRepo.findOne({ where: { id, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${id} not found`);
        Object.assign(topic, dto);
        return this.topicRepo.save(topic);
    }

    async deleteTopic(id: string, tenantId: string): Promise<{ message: string }> {
        const topic = await this.topicRepo.findOne({ where: { id, tenantId } });
        if (!topic) throw new NotFoundException(`Topic ${id} not found`);
        await this.topicRepo.softDelete(id);
        return { message: 'Topic deleted successfully' };
    }

    // ─── QUESTIONS ───────────────────────────────────────────────────────────

    private validateQuestionOptions(dto: CreateQuestionDto) {
        const { type, options = [], integerAnswer } = dto;

        if (type === QuestionType.INTEGER) {
            if (!integerAnswer) {
                throw new BadRequestException('integerAnswer is required for integer type questions');
            }
            if (options.length > 0) {
                throw new BadRequestException('Integer type questions must not have options');
            }
            return;
        }

        if (type === QuestionType.DESCRIPTIVE) {
            // options are optional/not needed for descriptive
            return;
        }

        // MCQ types — options required
        if (!options || options.length < 2) {
            throw new BadRequestException('MCQ questions require at least 2 options');
        }

        const correctOptions = options.filter((o) => o.isCorrect);
        if (type === QuestionType.MCQ_SINGLE && correctOptions.length !== 1) {
            throw new BadRequestException('mcq_single must have exactly one correct option');
        }
        if (type === QuestionType.MCQ_MULTI && correctOptions.length < 1) {
            throw new BadRequestException('mcq_multi must have at least one correct option');
        }
    }

    async createQuestion(dto: CreateQuestionDto, tenantId: string): Promise<Question> {
        this.logger.log(`Creating question for topic ${dto.topicId}, tenant ${tenantId}`);
        this.validateQuestionOptions(dto);

        // Topics are platform-level content — do not filter by institute tenantId
        const topic = await this.topicRepo.findOne({ where: { id: dto.topicId } });
        if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

        return this.dataSource.transaction(async (manager) => {
            const { options: optionDtos = [], ...questionData } = dto;
            const question = manager.create(Question, { ...questionData, tenantId });
            const savedQuestion = await manager.save(question);

            if (optionDtos.length > 0) {
                const optionEntities = optionDtos.map((o) =>
                    manager.create(QuestionOption, { ...o, questionId: savedQuestion.id }),
                );
                await manager.save(optionEntities);
            }

            return manager.findOne(Question, {
                where: { id: savedQuestion.id },
                relations: ['options'],
            });
        });
    }

    async getQuestions(
        query: QuestionQueryDto,
        tenantId: string,
    ): Promise<{ data: Question[]; meta: any }> {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const qb = this.questionRepo
            .createQueryBuilder('q')
            .leftJoinAndSelect('q.options', 'options')
            .where('q.tenantId = :tenantId', { tenantId })
            .andWhere('q.isActive = true');

        if (query.topicId) qb.andWhere('q.topicId = :topicId', { topicId: query.topicId });
        if (query.difficulty) qb.andWhere('q.difficulty = :difficulty', { difficulty: query.difficulty });
        if (query.type) qb.andWhere('q.type = :type', { type: query.type });
        if (query.source) qb.andWhere('q.source = :source', { source: query.source });
        if (query.search) {
            qb.andWhere('q.content ILIKE :search', { search: `%${query.search}%` });
        }

        qb.orderBy('q.createdAt', 'DESC').skip(skip).take(limit);

        const [data, total] = await qb.getManyAndCount();
        return {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };
    }

    async getQuestionById(id: string, tenantId: string): Promise<Question> {
        const question = await this.questionRepo.findOne({
            where: { id, tenantId },
            relations: ['options', 'topic'],
        });
        if (!question) throw new NotFoundException(`Question ${id} not found`);
        return question;
    }

    async updateQuestion(id: string, dto: UpdateQuestionDto, tenantId: string): Promise<Question> {
        this.logger.log(`Updating question ${id} for tenant ${tenantId}`);
        const question = await this.questionRepo.findOne({ where: { id, tenantId } });
        if (!question) throw new NotFoundException(`Question ${id} not found`);

        return this.dataSource.transaction(async (manager) => {
            const { options: optionDtos, ...questionData } = dto;
            Object.assign(question, questionData);
            await manager.save(question);

            if (optionDtos !== undefined) {
                // Replace all options
                await manager.delete(QuestionOption, { questionId: id });
                if (optionDtos.length > 0) {
                    const optionEntities = optionDtos.map((o) =>
                        manager.create(QuestionOption, { ...o, questionId: id }),
                    );
                    await manager.save(optionEntities);
                }
            }

            return manager.findOne(Question, { where: { id }, relations: ['options', 'topic'] });
        });
    }

    async deleteQuestion(id: string, tenantId: string): Promise<{ message: string }> {
        const question = await this.questionRepo.findOne({ where: { id, tenantId } });
        if (!question) throw new NotFoundException(`Question ${id} not found`);
        await this.questionRepo.softDelete(id);
        return { message: 'Question deleted successfully' };
    }

    async bulkCreateQuestions(
        dto: BulkCreateQuestionDto,
        tenantId: string,
    ): Promise<{ created: number; failed: number; errors: any[] }> {
        this.logger.log(`Bulk creating ${dto.questions.length} questions for tenant ${tenantId}`);
        let created = 0;
        let failed = 0;
        const errors: any[] = [];

        for (let i = 0; i < dto.questions.length; i++) {
            const q = dto.questions[i];
            try {
                this.validateQuestionOptions(q);
                await this.createQuestion(q, tenantId);
                created++;
            } catch (err) {
                failed++;
                errors.push({ index: i, content: q.content?.substring(0, 60), error: err.message });
            }
        }

        return { created, failed, errors };
    }

    // ─── LECTURES ────────────────────────────────────────────────────────────

    private async validateBatchAccess(batchId: string, userId: string, tenantId: string, isAdminOrAbove: boolean) {
        const batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId } });
        if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

        if (!isAdminOrAbove) {
            // Allow: primary batch teacher OR any subject teacher assigned to this batch
            const isPrimaryTeacher = batch.teacherId === userId;
            const isSubjectTeacher = await this.batchSubjectTeacherRepo.findOne({
                where: { batchId, tenantId, teacherId: userId },
            });
            if (!isPrimaryTeacher && !isSubjectTeacher) {
                throw new ForbiddenException('You are not assigned to this batch');
            }
        }
        return batch;
    }

    async createLecture(
        dto: CreateLectureDto,
        userId: string,
        tenantId: string,
        isAdmin: boolean,
    ): Promise<Lecture> {
        this.logger.log(`Creating lecture for batch ${dto.batchId}, tenant ${tenantId}`);

        await this.validateBatchAccess(dto.batchId, userId, tenantId, isAdmin);

        // Validate type-specific fields
        if (dto.type === LectureType.RECORDED && !dto.videoUrl) {
            throw new BadRequestException('videoUrl is required for recorded lectures');
        }
        if (dto.type === LectureType.LIVE) {
            if (!dto.scheduledAt) throw new BadRequestException('scheduledAt is required for live lectures');
        }

        const status =
            dto.type === LectureType.LIVE ? LectureStatus.SCHEDULED : LectureStatus.PROCESSING;

        const lecture = this.lectureRepo.create({
            ...dto,
            tenantId,
            teacherId: userId,
            status,
        });
        return this.lectureRepo.save(lecture);
    }

    async getLectures(
        query: LectureQueryDto,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<{ data: Lecture[]; meta: any }> {
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const qb = this.lectureRepo
            .createQueryBuilder('l')
            .where('l.tenantId = :tenantId', { tenantId });

        if (query.batchId) qb.andWhere('l.batchId = :batchId', { batchId: query.batchId });
        if (query.topicId) qb.andWhere('l.topicId = :topicId', { topicId: query.topicId });
        if (query.status) qb.andWhere('l.status = :status', { status: query.status });

        // Role-based filtering
        if (userRole === UserRole.STUDENT) {
            // Get enrolled batch IDs for this student
            const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
            if (student) {
                const enrollments = await this.enrollmentRepo.find({ where: { studentId: student.id } });
                const batchIds = enrollments.map((e) => e.batchId);
                if (batchIds.length > 0) {
                    qb.andWhere('l.batchId IN (:...batchIds)', { batchIds });
                } else {
                    // No enrollments — return empty
                    return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
                }
                qb.andWhere('l.status IN (:...statuses)', {
                    statuses: [LectureStatus.PUBLISHED, LectureStatus.LIVE, LectureStatus.SCHEDULED],
                });
            }
        } else if (userRole === UserRole.TEACHER) {
            qb.andWhere('l.teacherId = :userId', { userId });
        }
        // admin/super_admin sees all

        qb.orderBy('l.createdAt', 'DESC').skip(skip).take(limit);

        const [data, total] = await qb.getManyAndCount();
        const result: { data: Lecture[]; meta: any; aiStudyStatus?: any; quiz?: any; gateStatus?: any } = {
            data,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        };

        // Attach per-lecture progress, quiz, gate status, AI study status (student + topicId filter)
        if (query.topicId && userRole === UserRole.STUDENT) {
            const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
            if (student) {
                const lectureIds = data.map((l) => l.id);

                const [lectureProgresses, aiSession, mockTest, topicProgress, topic] = await Promise.all([
                    lectureIds.length
                        ? this.progressRepo.find({ where: { studentId: student.id, lectureId: In(lectureIds) } })
                        : [],
                    this.aiStudyRepo.findOne({ where: { studentId: student.id, topicId: query.topicId } }),
                    this.mockTestRepo.findOne({
                        where: { topicId: query.topicId, tenantId, isPublished: true },
                        order: { createdAt: 'DESC' },
                    }),
                    this.topicProgressRepo.findOne({ where: { studentId: student.id, topicId: query.topicId } }),
                    this.topicRepo.findOne({ where: { id: query.topicId, tenantId } }),
                ]);

                const progressByLecture = new Map<string, LectureProgress>(
                    lectureProgresses.map((p) => [p.lectureId, p] as [string, LectureProgress]),
                );

                // Attach student progress to each lecture
                (result as any).data = data.map((lec) => {
                    const lp = progressByLecture.get(lec.id);
                    return {
                        ...lec,
                        studentProgress: lp
                            ? { watchPercentage: lp.watchPercentage, lastPositionSeconds: lp.lastPositionSeconds, isCompleted: lp.isCompleted, rewindCount: lp.rewindCount }
                            : null,
                    };
                });

                // Quiz info
                result.quiz = mockTest
                    ? {
                        mockTestId: mockTest.id,
                        title: mockTest.title,
                        questionCount: (mockTest.questionIds as string[] | null)?.length ?? 0,
                        durationMinutes: mockTest.durationMinutes,
                        passingMarks: mockTest.passingMarks,
                        isPublished: mockTest.isPublished,
                    }
                    : null;

                // Gate status: canTakeQuiz if any lecture watched > 0 OR AI study completed
                const anyLectureStarted = lectureProgresses.some((p) => p.watchPercentage > 0);
                const aiStudyDone = aiSession?.isCompleted ?? false;
                const canTakeQuiz = anyLectureStarted || aiStudyDone;
                result.gateStatus = {
                    status: topicProgress?.status ?? 'locked',
                    bestAccuracy: topicProgress?.bestAccuracy ?? 0,
                    attemptCount: topicProgress?.attemptCount ?? 0,
                    gatePassPercentage: topic?.gatePassPercentage ?? 70,
                    canTakeQuiz,
                    quizUnlockReason: anyLectureStarted ? 'lecture_watched' : aiStudyDone ? 'ai_study_completed' : 'not_unlocked',
                };

                // AI study status
                result.aiStudyStatus = {
                    hasSession: !!aiSession,
                    sessionId: aiSession?.id ?? null,
                    isCompleted: aiSession?.isCompleted ?? false,
                    lessonMarkdown: aiSession?.lessonMarkdown ?? null,
                };
            }
        }

        return result;
    }

    async getLectureById(id: string, tenantId: string): Promise<Lecture> {
        const lecture = await this.lectureRepo.findOne({
            where: { id, tenantId },
            relations: ['topic', 'batch'],
        });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);
        return lecture;
    }

    async updateLecture(
        id: string,
        dto: UpdateLectureDto,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<Lecture> {
        this.logger.log(`Updating lecture ${id} for tenant ${tenantId}`);
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);

        const isAdmin =
            userRole === UserRole.INSTITUTE_ADMIN || userRole === UserRole.SUPER_ADMIN;

        if (!isAdmin && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only modify your own lectures');
        }

        Object.assign(lecture, dto);
        return this.lectureRepo.save(lecture);
    }

    async deleteLecture(
        id: string,
        userId: string,
        userRole: UserRole,
        tenantId: string,
    ): Promise<{ message: string }> {
        const lecture = await this.lectureRepo.findOne({ where: { id, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${id} not found`);

        const isAdmin =
            userRole === UserRole.INSTITUTE_ADMIN || userRole === UserRole.SUPER_ADMIN;

        if (!isAdmin && lecture.teacherId !== userId) {
            throw new ForbiddenException('You can only delete your own lectures');
        }

        await this.lectureRepo.softDelete(id);
        return { message: 'Lecture deleted successfully' };
    }

    // ─── LECTURE PROGRESS ────────────────────────────────────────────────────

    async upsertProgress(
        lectureId: string,
        dto: UpsertProgressDto,
        userId: string,
        tenantId: string,
    ): Promise<any> {
        this.logger.log(`Upserting progress for lecture ${lectureId}, user ${userId}`);

        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        let progress = await this.progressRepo.findOne({
            where: { lectureId, studentId: student.id },
        });

        const wasCompleted = progress?.isCompleted ?? false;

        if (!progress) {
            progress = this.progressRepo.create({
                lectureId,
                studentId: student.id,
                tenantId,
            });
        }

        progress.watchPercentage = dto.watchPercentage;
        progress.lastPositionSeconds = dto.lastPositionSeconds;
        if (dto.rewindCount !== undefined) progress.rewindCount = dto.rewindCount;
        if (dto.confusionFlags !== undefined) progress.confusionFlags = dto.confusionFlags;
        if (dto.watchPercentage >= 90) progress.isCompleted = true;

        const saved = await this.progressRepo.save(progress);

        // ── Transition TopicProgress UNLOCKED → IN_PROGRESS on first watch ───
        if (lecture.topicId && dto.watchPercentage > 0) {
            let topicProg = await this.topicProgressRepo.findOne({
                where: { studentId: student.id, topicId: lecture.topicId },
            });
            if (!topicProg) {
                topicProg = this.topicProgressRepo.create({
                    studentId: student.id,
                    topicId: lecture.topicId,
                    tenantId,
                    status: TopicStatus.IN_PROGRESS,
                    unlockedAt: new Date(),
                });
                await this.topicProgressRepo.save(topicProg);
            } else if (topicProg.status === TopicStatus.UNLOCKED || topicProg.status === TopicStatus.LOCKED) {
                topicProg.status = TopicStatus.IN_PROGRESS;
                if (!topicProg.unlockedAt) topicProg.unlockedAt = new Date();
                await this.topicProgressRepo.save(topicProg);
            }
        }

        // ── On first completion, award XP + auto-complete plan item ──────────
        if (!wasCompleted && saved.isCompleted && lecture.topicId) {
            const XP_PER_LECTURE = 10;

            // Award XP
            student.xpTotal = (student.xpTotal ?? 0) + XP_PER_LECTURE;
            await this.dataSource.getRepository(Student).save(student);

            // Auto-complete the plan item for this lecture (if any, pending/in-progress)
            const plan = await this.studyPlanRepo.findOne({
                where: { studentId: student.id, tenantId },
                order: { createdAt: 'DESC' },
            });
            if (plan) {
                await this.planItemRepo
                    .createQueryBuilder()
                    .update(PlanItem)
                    .set({ status: PlanItemStatus.COMPLETED, completedAt: new Date() })
                    .where('planId = :planId', { planId: plan.id })
                    .andWhere('refId = :refId', { refId: lectureId })
                    .andWhere('type = :type', { type: PlanItemType.LECTURE })
                    .andWhere('status != :done', { done: PlanItemStatus.COMPLETED })
                    .execute();
            }

            // Find quiz (mock test) linked to this topic so the frontend knows it's available
            const quiz = await this.mockTestRepo.findOne({
                where: { topicId: lecture.topicId, tenantId },
                select: ['id', 'topicId', 'questionIds', 'durationMinutes'],
            });

            const completionReward = {
                xpAwarded: XP_PER_LECTURE,
                quizAvailable: !!quiz,
                mockTestId: quiz?.id ?? null,
                topicId: lecture.topicId,
                message: quiz
                    ? `+${XP_PER_LECTURE} XP earned! Topic quiz is now available.`
                    : `+${XP_PER_LECTURE} XP earned! Lecture completed.`,
            };

            this.logger.log(
                `Lecture ${lectureId} completed by student ${student.id}: ${completionReward.message}`,
            );

            return { ...saved, completionReward };
        }

        return saved;
    }

    async getProgress(
        lectureId: string,
        userId: string,
        userRole: UserRole,
        tenantId: string,
        studentIdOverride?: string,
    ): Promise<LectureProgress | null> {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        let studentId: string;

        const isAdmin =
            userRole === UserRole.INSTITUTE_ADMIN ||
            userRole === UserRole.SUPER_ADMIN ||
            userRole === UserRole.TEACHER;

        if (isAdmin && studentIdOverride) {
            // Admin viewing a specific student
            studentId = studentIdOverride;
        } else {
            const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
            if (!student) throw new NotFoundException('Student profile not found');
            studentId = student.id;
        }

        return this.progressRepo.findOne({ where: { lectureId, studentId } });
    }

    async getLectureStats(lectureId: string, tenantId: string) {
        this.logger.log(`Getting stats for lecture ${lectureId}`);
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const allProgress = await this.progressRepo.find({ where: { lectureId } });

        const totalStudents = allProgress.length;
        const watchedCount = allProgress.filter((p) => p.watchPercentage > 0).length;
        const completedCount = allProgress.filter((p) => p.isCompleted).length;
        const avgWatchPercentage =
            totalStudents > 0
                ? allProgress.reduce((sum, p) => sum + p.watchPercentage, 0) / totalStudents
                : 0;

        // Aggregate confusion flags across all students → top 5 hotspots
        const flagMap = new Map<number, number>();
        for (const p of allProgress) {
            if (p.confusionFlags) {
                for (const flag of p.confusionFlags) {
                    flagMap.set(
                        flag.timestampSeconds,
                        (flagMap.get(flag.timestampSeconds) || 0) + flag.rewindCount,
                    );
                }
            }
        }
        const confusionHotspots = Array.from(flagMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([timestampSeconds, totalRewinds]) => ({ timestampSeconds, totalRewinds }));

        return {
            totalStudents,
            watchedCount,
            completedCount,
            avgWatchPercentage: Math.round(avgWatchPercentage * 100) / 100,
            confusionHotspots,
        };
    }

    // ── Quiz Checkpoints ──────────────────────────────────────────────────────

    async saveQuizCheckpoints(lectureId: string, questions: any[], userId: string, tenantId: string) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);
        lecture.quizCheckpoints = questions;
        await this.lectureRepo.save(lecture);
        return { message: 'Quiz saved', count: questions.length };
    }

    async getQuizCheckpoints(lectureId: string, tenantId: string) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);
        return lecture.quizCheckpoints ?? [];
    }

    async submitQuizResponse(
        lectureId: string,
        dto: { questionId: string; selectedOption: string; timeTakenSeconds?: number },
        userId: string,
        tenantId: string,
    ) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const question = (lecture.quizCheckpoints ?? []).find((q) => q.id === dto.questionId);
        if (!question) throw new NotFoundException(`Question ${dto.questionId} not found`);

        const isCorrect = question.correctOption === dto.selectedOption;

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        let progress = await this.progressRepo.findOne({ where: { lectureId, studentId: student.id } });
        if (!progress) {
            progress = this.progressRepo.create({ lectureId, studentId: student.id, tenantId });
        }

        const existing = (progress.quizResponses ?? []).findIndex((r) => r.questionId === dto.questionId);
        const response = {
            questionId: dto.questionId,
            selectedOption: dto.selectedOption,
            isCorrect,
            answeredAt: new Date().toISOString(),
            timeTakenSeconds: dto.timeTakenSeconds,
        };
        if (existing >= 0) {
            progress.quizResponses[existing] = response;
        } else {
            progress.quizResponses = [...(progress.quizResponses ?? []), response];
        }

        await this.progressRepo.save(progress);
        return { isCorrect, correctOption: question.correctOption, explanation: question.explanation };
    }

    async getWatchAnalytics(lectureId: string, tenantId: string) {
        const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
        if (!lecture) throw new NotFoundException(`Lecture ${lectureId} not found`);

        const allProgress = await this.progressRepo.find({
            where: { lectureId },
            relations: ['student'],
        });

        const questions = lecture.quizCheckpoints ?? [];

        // Per-student summary
        const students = allProgress.map((p) => {
            const responses = p.quizResponses ?? [];
            const answered = responses.length;
            const correct = responses.filter((r) => r.isCorrect).length;
            return {
                studentId: p.studentId,
                studentName: (p.student as any)?.fullName ?? 'Unknown',
                watchPercentage: p.watchPercentage,
                isCompleted: p.isCompleted,
                lastPositionSeconds: p.lastPositionSeconds,
                quizScore: answered > 0 ? Math.round((correct / answered) * 100) : null,
                answeredCount: answered,
                correctCount: correct,
                responses,
            };
        });

        // Per-question accuracy
        const questionStats = questions.map((q) => {
            const attempts = allProgress.flatMap((p) =>
                (p.quizResponses ?? []).filter((r) => r.questionId === q.id),
            );
            const correct = attempts.filter((r) => r.isCorrect).length;
            return {
                questionId: q.id,
                questionText: q.questionText,
                segmentTitle: q.segmentTitle,
                totalAttempts: attempts.length,
                correctCount: correct,
                accuracy: attempts.length > 0 ? Math.round((correct / attempts.length) * 100) : null,
            };
        });

        return { students, questionStats, totalWatchers: allProgress.length };
    }

    // ─── AI STUDY ─────────────────────────────────────────────────────────────

    async getStudyStatus(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({ where: { id: topicId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const enrollments = await this.enrollmentRepo.find({ where: { studentId: student.id } });
        const batchIds = enrollments.map((e) => e.batchId);

        let lectureCount = 0;
        if (batchIds.length > 0) {
            lectureCount = await this.lectureRepo.count({
                where: { topicId, status: LectureStatus.PUBLISHED, batchId: In(batchIds) },
            });
        }

        const aiSession = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });

        return {
            topicId,
            topicName: topic.name,
            hasTeacherLecture: lectureCount > 0,
            lectureCount,
            hasAiSession: !!aiSession,
            aiSessionId: aiSession?.id ?? null,
            isAiSessionCompleted: aiSession?.isCompleted ?? false,
            gatePassPercentage: (topic as any).gatePassPercentage ?? 70,
            estimatedStudyMinutes: (topic as any).estimatedStudyMinutes ?? 60,
        };
    }

    async startAiStudy(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({
            where: { id: topicId },
            relations: ['chapter', 'chapter.subject'],
        });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const chapter = (topic as any).chapter;
        const subject = chapter?.subject;

        // Resume existing session (completed or not)
        const existing = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (existing) {
            // Backfill practice questions if missing (e.g., sessions created before this feature)
            if (!existing.practiceQuestions || existing.practiceQuestions.length === 0) {
                try {
                    const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                        { topicId, topicName: topic.name, count: 8, difficulty: 'mixed', type: 'mcq_single' },
                        tenantId,
                    ) as any[];
                    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
                        existing.practiceQuestions = rawQuestions.map((q: any) => {
                            const correctOption = (q.options || []).find((o: any) => o.isCorrect);
                            return {
                                question: q.content || '',
                                answer: correctOption?.content || '',
                                explanation: q.explanation || '',
                            };
                        }).filter((q: any) => q.question);
                        await this.aiStudyRepo.save(existing);
                    }
                } catch (err) {
                    this.logger.warn(`Backfill practice questions failed for session ${existing.id}: ${err.message}`);
                }
            }
            return {
                id: existing.id,
                topicId,
                topicName: topic.name,
                lessonMarkdown: existing.lessonMarkdown,
                keyConcepts: existing.keyConcepts,
                formulas: existing.formulas,
                practiceQuestions: existing.practiceQuestions,
                commonMistakes: existing.commonMistakes,
                conversation: existing.conversation,
                isCompleted: existing.isCompleted,
                timeSpentSeconds: existing.timeSpentSeconds,
                completedAt: existing.completedAt ?? null,
                isNew: false,
            };
        }

        const examTarget = student.examTarget?.toUpperCase() ?? 'JEE';
        const studentClass = (student as any).class ?? '12';
        const topicName = topic.name;
        const chapterName = chapter?.name ?? '';
        const subjectName = subject?.name ?? '';

        const selfStudyPrompt = `You are a master ${subjectName || 'Science'} teacher who has helped thousands of students crack ${examTarget}. Your lessons are legendary for being crystal-clear, deeply comprehensive, and exam-focused.

Generate a COMPLETE, THOROUGH self-study lesson. This must be the BEST lesson the student has ever read on this topic. Do not cut corners — depth and clarity are the priority.

Topic: ${topicName}
Chapter: ${chapterName}
Subject: ${subjectName}
Exam Target: ${examTarget}
Class: ${studentClass}

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topicName}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters for ${examTarget}, and what real-world phenomena it explains. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — where this topic fits in ${subjectName}, what prior knowledge it builds on, and the intuition behind it. Use analogies to make abstract ideas concrete. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept in this topic:
### Concept Name
- Clear definition
- Physical/chemical/mathematical meaning
- Intuitive explanation with a relatable analogy or real-world example
- What happens as variables change (if applicable)
- A short illustrative example

Cover ALL concepts — do not skip any.

## 📐 Formulas & Equations
For EVERY formula:
### Formula Name
$$formula$$
- Variables: define each symbol
- Units: state SI units for each
- Conditions: when it applies / assumptions
- How to remember it (mnemonic or pattern)

## 📊 Derivations
For the most important formula(s):
### Derivation of [Formula Name]
Step-by-step derivation with:
- Starting point (fundamental laws/principles)
- Each algebraic step clearly numbered
- Physical meaning of each step
- Final result with units check

## 💡 Solved Examples
### Example 1 — Basic (Concept check)
[Full problem statement]
**Solution:**
Step 1: ...
Step 2: ...
**Answer:** ...
**Key takeaway:** ...

### Example 2 — Intermediate
[Full problem with 2-3 steps]
**Solution:** (detailed)

### Example 3 — ${examTarget} Level (Hard)
[A tricky exam-style question]
**Solution:** (complete step-by-step)
**Examiner's Trap:** explain the trick/trap they set

## 🧠 Connections to Other Topics
- How this topic links to [related topic 1]
- How it connects to [related topic 2]
- Topics that depend on understanding this one

## ⚠️ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 ${examTarget} Exam Strategy
- How this topic typically appears in ${examTarget} (question types, weightage)
- Which formulas are most tested
- Speed tricks and shortcuts for calculations
- 2-3 previous year question patterns (describe the pattern, not actual PYQs)

## 📝 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize. These should be the things a student checks 10 minutes before the exam.

## 🔁 Self-Check Questions
5 questions the student should be able to answer after reading this lesson (no answers — just the questions to test themselves):
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topicName}.`;

        let lessonMarkdown = '';
        let aiSessionRef: string | null = null;
        let keyConcepts: string[] = [];
        let formulas: string[] = [];
        let commonMistakes: string[] = [];
        let practiceQuestions: Array<{ question: string; answer: string; explanation: string }> = [];

        try {
            const lessonResponse = await this.aiBridgeService.startTutorSession(
                { studentId: student.id, topicId, context: selfStudyPrompt },
                tenantId,
            ) as any;

            lessonMarkdown = this.extractAiText(lessonResponse);
            aiSessionRef = this.extractAiSessionRef(lessonResponse);
            keyConcepts = this.extractBulletSection(lessonMarkdown, 'Core Concepts');
            formulas = this.extractBulletSection(lessonMarkdown, 'Key Formulas');
            commonMistakes = this.extractBulletSection(lessonMarkdown, 'Common Mistakes Students Make');
        } catch (err) {
            this.logger.warn(`AI lesson generation failed for topic ${topicId}: ${err.message}`);
            lessonMarkdown = 'AI lesson generation is temporarily unavailable. Please try again or ask your teacher.';
        }

        // Second call: practice questions via dedicated question-generation endpoint
        try {
            const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                { topicId, topicName: topic.name, count: 8, difficulty: 'mixed', type: 'mcq_single' },
                tenantId,
            ) as any[];

            if (Array.isArray(rawQuestions)) {
                practiceQuestions = rawQuestions.map((q: any) => {
                    const correctOption = (q.options || []).find((o: any) => o.isCorrect);
                    return {
                        question: q.content || '',
                        answer: correctOption?.content || '',
                        explanation: q.explanation || '',
                    };
                }).filter((q: any) => q.question);
            }
        } catch (err) {
            this.logger.warn(`Practice question generation failed for topic ${topicId}: ${err.message}`);
        }

        const introMessage = lessonMarkdown.split('\n').find((l) => l.trim() && !l.startsWith('#'))
            ?? `Here is your AI-generated lesson on ${topicName}.`;

        const session = this.aiStudyRepo.create({
            tenantId,
            studentId: student.id,
            topicId,
            lessonMarkdown,
            keyConcepts,
            formulas,
            practiceQuestions,
            commonMistakes,
            aiSessionRef,
            conversation: [{ role: 'ai', message: introMessage, timestamp: new Date().toISOString() }],
        });

        const saved = await this.aiStudyRepo.save(session);

        return {
            id: saved.id,
            topicId,
            topicName: topic.name,
            lessonMarkdown: saved.lessonMarkdown,
            keyConcepts: saved.keyConcepts,
            formulas: saved.formulas,
            practiceQuestions: saved.practiceQuestions,
            commonMistakes: saved.commonMistakes,
            conversation: saved.conversation,
            isCompleted: saved.isCompleted,
            timeSpentSeconds: saved.timeSpentSeconds,
            completedAt: saved.completedAt ?? null,
            isNew: true,
        };
    }

    async askAiQuestion(
        topicId: string,
        sessionId: string,
        dto: AskAiQuestionDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const session = await this.aiStudyRepo.findOne({
            where: { id: sessionId, studentId: student.id, topicId },
        });
        if (!session) throw new NotFoundException('AI study session not found');

        let aiResponse = '';
        try {
            const response = await this.aiBridgeService.continueTutorSession(
                { sessionId: session.aiSessionRef ?? sessionId, studentMessage: dto.question },
                tenantId,
            ) as any;
            aiResponse = this.extractAiText(response);
        } catch (err) {
            this.logger.warn(`AI follow-up failed for session ${sessionId}: ${err.message}`);
            aiResponse = 'I could not process your question right now. Please try again.';
        }

        const now = new Date().toISOString();
        const newMessages = [
            { role: 'student' as const, message: dto.question, timestamp: now },
            { role: 'ai' as const, message: aiResponse, timestamp: now },
        ];

        // Keep max 50 messages: always preserve the first (lesson intro) + last 49
        const firstMessage = session.conversation[0];
        let updated = [...session.conversation, ...newMessages];
        if (updated.length > 50) {
            updated = [firstMessage, ...updated.slice(-49)];
        }
        session.conversation = updated;
        await this.aiStudyRepo.save(session);

        return {
            sessionId: session.id,
            studentQuestion: dto.question,
            aiResponse,
            timestamp: now,
            conversation: session.conversation,
        };
    }

    async completeAiStudy(
        topicId: string,
        sessionId: string,
        dto: CompleteAiStudyDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const session = await this.aiStudyRepo.findOne({
            where: { id: sessionId, studentId: student.id, topicId },
        });
        if (!session) throw new NotFoundException('AI study session not found');

        const now = new Date();
        session.isCompleted = true;
        session.completedAt = now;
        session.timeSpentSeconds = dto.timeSpentSeconds;
        await this.aiStudyRepo.save(session);

        // Upsert TopicProgress — unlock topic for quiz
        let progress = await this.topicProgressRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (!progress) {
            progress = this.topicProgressRepo.create({
                tenantId,
                studentId: student.id,
                topicId,
                status: TopicStatus.UNLOCKED,
                studiedWithAi: true,
                unlockedAt: now,
            });
        } else {
            progress.studiedWithAi = true;
            if (progress.status === TopicStatus.LOCKED) {
                progress.status = TopicStatus.UNLOCKED;
                progress.unlockedAt = now;
            }
        }
        await this.topicProgressRepo.save(progress);

        // Award +10 XP
        const XP_AWARD = 10;
        await this.dataSource.getRepository(Student).increment({ id: student.id }, 'xpTotal', XP_AWARD);
        const updated = await this.dataSource.getRepository(Student).findOne({ where: { id: student.id } });

        // Check if a quiz (mock test) is available for this topic
        const mockTest = await this.dataSource.getRepository(MockTest).findOne({
            where: { tenantId, topicId, isPublished: true } as any,
        });

        const topic = await this.topicRepo.findOne({ where: { id: topicId } });

        return {
            sessionId: session.id,
            isCompleted: true,
            xpAwarded: XP_AWARD,
            totalXp: updated?.xpTotal ?? 0,
            quizAvailable: !!mockTest,
            mockTestId: mockTest?.id ?? null,
            message: `Great work! You've studied ${topic?.name ?? 'the topic'}. Ready to test yourself?`,
        };
    }

    async getAiStudySession(topicId: string, userId: string, tenantId?: string) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) return null;

        const session = await this.aiStudyRepo.findOne({
            where: { studentId: student.id, topicId },
        });
        if (!session) return null;

        // Backfill practice questions if missing
        if ((!session.practiceQuestions || session.practiceQuestions.length === 0) && tenantId) {
            try {
                const topic = await this.topicRepo.findOne({ where: { id: topicId } });
                if (topic) {
                    const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                        { topicId, topicName: topic.name, count: 8, difficulty: 'mixed', type: 'mcq_single' },
                        tenantId,
                    ) as any[];
                    if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
                        session.practiceQuestions = rawQuestions.map((q: any) => {
                            const correctOption = (q.options || []).find((o: any) => o.isCorrect);
                            return {
                                question: q.content || '',
                                answer: correctOption?.content || '',
                                explanation: q.explanation || '',
                            };
                        }).filter((q: any) => q.question);
                        await this.aiStudyRepo.save(session);
                    }
                }
            } catch (err) {
                this.logger.warn(`Backfill practice questions failed for session ${session.id}: ${err.message}`);
            }
        }

        return {
            id: session.id,
            topicId,
            lessonMarkdown: session.lessonMarkdown,
            keyConcepts: session.keyConcepts,
            formulas: session.formulas,
            practiceQuestions: session.practiceQuestions,
            commonMistakes: session.commonMistakes,
            conversation: session.conversation,
            isCompleted: session.isCompleted,
            timeSpentSeconds: session.timeSpentSeconds,
            completedAt: session.completedAt ?? null,
        };
    }

    // ─── AI helpers ───────────────────────────────────────────────────────────

    private extractAiText(response: any): string {
        if (!response) return '';
        if (typeof response === 'string') return response;
        return response.response
            ?? response.message
            ?? response.data?.response
            ?? response.data?.message
            ?? response.text
            ?? '';
    }

    private extractAiSessionRef(response: any): string | null {
        if (!response || typeof response !== 'object') return null;
        return response.sessionId ?? response.session_id ?? response.id ?? null;
    }

    private extractBulletSection(markdown: string, header: string): string[] {
        const regex = new RegExp(`##\\s+${header}([^#]*)`, 'i');
        const match = markdown.match(regex);
        if (!match) return [];
        return match[1]
            .split('\n')
            .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
            .filter((l) => l.length > 3 && !l.startsWith('['));
    }


    // ─── AI Quiz ──────────────────────────────────────────────────────────────

    async generateAiQuiz(topicId: string, userId: string, tenantId: string) {
        const topic = await this.topicRepo.findOne({ where: { id: topicId } });
        if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

        let rawQuestions: any[] = [];
        try {
            rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
                { topicId, topicName: topic.name, count: 5, difficulty: 'mixed', type: 'mcq_single' },
                tenantId,
            ) as any[];
        } catch (err) {
            this.logger.warn(`AI quiz generation failed for topic ${topicId}: ${err.message}`);
            throw new BadRequestException('AI quiz generation is temporarily unavailable. Please try again.');
        }

        if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
            throw new BadRequestException('AI could not generate questions. Please try again.');
        }

        const difficulties = ['easy', 'easy', 'medium', 'medium', 'hard'];
        const formatted = rawQuestions.slice(0, 10).map((q: any, qi: number) => ({
            id: `ai-${topicId.slice(0, 8)}-${qi}`,
            content: q.content ?? q.question ?? '',
            type: 'mcq_single',
            difficulty: q.difficulty ?? difficulties[qi] ?? 'medium',
            marksCorrect: 4,
            marksWrong: 1,
            explanation: q.explanation ?? '',
            options: (q.options ?? []).map((opt: any, oi: number) => ({
                id: `ai-${topicId.slice(0, 8)}-${qi}-${oi}`,
                optionLabel: opt.label ?? String.fromCharCode(65 + oi),
                content: opt.content ?? String(opt),
                isCorrect: !!opt.isCorrect,
            })),
        }));

        return {
            topicId,
            topicName: topic.name,
            durationMinutes: 15,
            totalMarks: formatted.length * 4,
            passingMarks: Math.ceil(formatted.length * 4 * 0.7),
            questions: formatted,
        };
    }

    async completeAiQuiz(
        topicId: string,
        dto: CompleteAiQuizDto,
        userId: string,
        tenantId: string,
    ) {
        const student = await this.dataSource.getRepository(Student).findOne({ where: { userId } });
        if (!student) throw new NotFoundException('Student profile not found');

        const passed = dto.accuracy >= 70;
        const now = new Date();

        let progress = await this.topicProgressRepo.findOne({
            where: { studentId: student.id, topicId },
        });

        if (!progress) {
            progress = this.topicProgressRepo.create({
                tenantId,
                studentId: student.id,
                topicId,
                status: passed ? TopicStatus.COMPLETED : TopicStatus.IN_PROGRESS,
                bestAccuracy: dto.accuracy,
                ...(passed ? { completedAt: now } : {}),
            });
        } else {
            if (passed) {
                progress.status = TopicStatus.COMPLETED;
                if (!progress.completedAt) progress.completedAt = now;
            } else if (progress.status === TopicStatus.LOCKED || progress.status === TopicStatus.UNLOCKED) {
                progress.status = TopicStatus.IN_PROGRESS;
            }
            if (dto.accuracy > (progress.bestAccuracy ?? 0)) {
                progress.bestAccuracy = dto.accuracy;
            }
        }
        await this.topicProgressRepo.save(progress);

        const xpEarned = passed ? 15 : 0;
        if (xpEarned > 0) {
            await this.dataSource.getRepository(Student).increment({ id: student.id }, 'xpTotal', xpEarned);
        }

        return {
            passed,
            accuracy: dto.accuracy,
            score: dto.score,
            totalMarks: dto.totalMarks,
            xpEarned,
            message: passed
                ? `Excellent! You passed with ${dto.accuracy.toFixed(0)}% accuracy. Next topic unlocked!`
                : `You scored ${dto.accuracy.toFixed(0)}%. Need 70%+ to pass. Keep practising!`,
        };
    }
}
