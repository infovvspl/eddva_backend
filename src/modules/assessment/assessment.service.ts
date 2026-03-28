import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import {
  ErrorType,
  MockTest,
  MockTestType,
  QuestionAttempt,
  TestSession,
  TestSessionStatus,
  TopicProgress,
  TopicStatus,
} from '../../database/entities/assessment.entity';
import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { DifficultyLevel, Question, QuestionOption, QuestionSource, QuestionType } from '../../database/entities/question.entity';
import { Chapter, Subject, Topic } from '../../database/entities/subject.entity';
import { ExamTarget, Student } from '../../database/entities/student.entity';
import { UserRole } from '../../database/entities/user.entity';
import { WeakTopic, WeakTopicSeverity } from '../../database/entities/analytics.entity';

import { GradingService } from './grading.service';
import { StudyPlanService } from '../study-plan/study-plan.service';
import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { AnswerQuestionDto } from './dto/answer.dto';
import { CreateMockTestDto, MockTestListQueryDto, UpdateMockTestDto } from './dto/mock-test.dto';
import { SessionListQueryDto, StartSessionDto } from './dto/session.dto';

type MockTestSchema = {
  batchId: boolean;
  topicId: boolean;
  passingMarks: boolean;
  isPublished: boolean;
  shuffleQuestions: boolean;
  showAnswersAfterSubmit: boolean;
  allowReattempt: boolean;
};

@Injectable()
export class AssessmentService {
  private readonly logger = new Logger(AssessmentService.name);
  private mockTestSchemaPromise: Promise<MockTestSchema> | null = null;

  constructor(
    @InjectRepository(MockTest)
    private readonly mockTestRepo: Repository<MockTest>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(QuestionAttempt)
    private readonly attemptRepo: Repository<QuestionAttempt>,
    @InjectRepository(TopicProgress)
    private readonly progressRepo: Repository<TopicProgress>,
    @InjectRepository(Question)
    private readonly questionRepo: Repository<Question>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    private readonly gradingService: GradingService,
    private readonly dataSource: DataSource,
    private readonly studyPlanService: StudyPlanService,
    private readonly aiBridgeService: AiBridgeService,
  ) {}

  async createMockTest(dto: CreateMockTestDto, user: any, tenantId: string) {
    const schema = await this.getMockTestSchema();
    const batch = await this.validateBatchAccess(dto.batchId, user, tenantId);
    const questions = await this.loadAndValidateQuestions(dto.questionIds, tenantId, dto.topicId);

    const mockTest = this.mockTestRepo.create({
      tenantId,
      title: dto.title,
      type: dto.topicId ? MockTestType.CHAPTER_TEST : MockTestType.FULL_MOCK,
      totalMarks: dto.totalMarks,
      durationMinutes: dto.durationMinutes,
      questionIds: questions.map((question) => question.id),
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      createdBy: user.id,
      isActive: true,
    });

    const saved = await this.mockTestRepo.save(mockTest);
    await this.updateOptionalMockTestColumns(
      saved.id,
      {
        batchId: batch.id,
        topicId: dto.topicId ?? null,
        passingMarks: dto.passingMarks ?? null,
        isPublished: false,
        shuffleQuestions: dto.shuffleQuestions ?? false,
        showAnswersAfterSubmit: dto.showAnswersAfterSubmit ?? true,
        allowReattempt: dto.allowReattempt ?? false,
      },
      schema,
    );

    return this.getMockTestById(saved.id, user, tenantId);
  }

  async getMockTests(query: MockTestListQueryDto, user: any, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;
    const schema = await this.getMockTestSchema();
    const enrolledBatchIds =
      user.role === UserRole.STUDENT ? await this.getStudentBatchIds(user.id, tenantId) : [];

    const filters: string[] = ['mt.tenant_id = $1', 'mt.deleted_at IS NULL'];
    const params: any[] = [tenantId];
    let index = params.length + 1;

    if (query.batchId && schema.batchId) {
      filters.push(`mt.batch_id = $${index++}`);
      params.push(query.batchId);
    }

    if (query.isPublished !== undefined && schema.isPublished) {
      filters.push(`mt.is_published = $${index++}`);
      params.push(query.isPublished);
    }

    if (user.role === UserRole.TEACHER) {
      filters.push(`mt.created_by = $${index++}`);
      params.push(user.id);
    }

    if (user.role === UserRole.STUDENT) {
      if (!schema.batchId || !schema.isPublished || !enrolledBatchIds.length) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }

      filters.push(`mt.batch_id = ANY($${index++})`);
      params.push(enrolledBatchIds);
      filters.push('mt.is_published = true');
    }

    const whereSql = filters.join(' AND ');
    const data = await this.dataSource.query(
      `
        SELECT ${this.getMockTestSelectColumns(schema)}
        FROM mock_tests mt
        WHERE ${whereSql}
        ORDER BY mt.created_at DESC
        LIMIT $${index++} OFFSET $${index++}
      `,
      [...params, limit, offset],
    );
    const countResult = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM mock_tests mt WHERE ${whereSql}`,
      params,
    );

    const total = countResult[0]?.total || 0;
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async getMockTestById(id: string, user: any, tenantId: string) {
    const schema = await this.getMockTestSchema();
    const mockTest = await this.getMockTestRecord(id, tenantId, schema);
    await this.assertMockTestReadAccess(mockTest, user, tenantId, schema);

    const questions = await this.questionRepo.find({
      where: { tenantId, id: In(mockTest.questionIds || []) },
      relations: ['options', 'topic'],
    });

    return {
      ...mockTest,
      questions: this.sortQuestionsByIds(
        questions.map((question) =>
          user.role === UserRole.STUDENT ? this.sanitizeQuestionForStudent(question) : question,
        ),
        mockTest.questionIds || [],
      ),
    };
  }

  async updateMockTest(id: string, dto: UpdateMockTestDto, user: any, tenantId: string) {
    const schema = await this.getMockTestSchema();
    const mockTest = await this.mockTestRepo.findOne({ where: { id, tenantId } });
    if (!mockTest) throw new NotFoundException(`Mock test ${id} not found`);

    await this.assertMockTestWriteAccess(mockTest, user);

    let questionIds = mockTest.questionIds;
    if (dto.questionIds) {
      const questions = await this.loadAndValidateQuestions(dto.questionIds, tenantId, dto.topicId);
      questionIds = questions.map((question) => question.id);
    }

    if (dto.batchId) {
      await this.validateBatchAccess(dto.batchId, user, tenantId);
    }

    Object.assign(mockTest, {
      title: dto.title ?? mockTest.title,
      totalMarks: dto.totalMarks ?? mockTest.totalMarks,
      durationMinutes: dto.durationMinutes ?? mockTest.durationMinutes,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : mockTest.scheduledAt,
      questionIds,
      type:
        dto.topicId !== undefined
          ? dto.topicId
            ? MockTestType.CHAPTER_TEST
            : MockTestType.FULL_MOCK
          : mockTest.type,
    });

    await this.mockTestRepo.save(mockTest);
    await this.updateOptionalMockTestColumns(
      id,
      {
        batchId: dto.batchId,
        topicId: dto.topicId,
        passingMarks: dto.passingMarks,
        isPublished: dto.isPublished,
        shuffleQuestions: dto.shuffleQuestions,
        showAnswersAfterSubmit: dto.showAnswersAfterSubmit,
        allowReattempt: dto.allowReattempt,
      },
      schema,
    );

    return this.getMockTestById(id, user, tenantId);
  }

  async deleteMockTest(id: string, user: any, tenantId: string) {
    const mockTest = await this.mockTestRepo.findOne({ where: { id, tenantId } });
    if (!mockTest) throw new NotFoundException(`Mock test ${id} not found`);
    await this.assertMockTestWriteAccess(mockTest, user);
    await this.mockTestRepo.softDelete(id);
    return { message: 'Mock test deleted successfully' };
  }

  async startSession(dto: StartSessionDto, userId: string, tenantId: string) {
    const schema = await this.getMockTestSchema();
    const student = await this.getStudentByUserId(userId, tenantId);
    const mockTest = await this.getMockTestRecord(dto.mockTestId, tenantId, schema);

    if (schema.batchId && mockTest.batchId) {
      await this.assertStudentEnrollment(student.id, mockTest.batchId, tenantId);
    }

    if (schema.isPublished && !mockTest.isPublished) {
      throw new ForbiddenException('This test is not published');
    }

    const activeSession = await this.sessionRepo.findOne({
      where: {
        tenantId,
        studentId: student.id,
        mockTestId: dto.mockTestId,
        status: TestSessionStatus.IN_PROGRESS,
      },
    });
    if (activeSession) {
      throw new BadRequestException('An active session already exists for this test');
    }

    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        tenantId,
        studentId: student.id,
        mockTestId: dto.mockTestId,
        status: TestSessionStatus.IN_PROGRESS,
        startedAt: new Date(),
      }),
    );

    const payload = await this.getSessionPayload(session.id, tenantId);
    return this.serializeSession(payload, true);
  }

  async answerQuestion(sessionId: string, dto: AnswerQuestionDto, userId: string, tenantId: string) {
    const schema = await this.getMockTestSchema();
    const student = await this.getStudentByUserId(userId, tenantId);
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId, studentId: student.id },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.status !== TestSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('Session is not in progress');
    }

    const mockTest = await this.getMockTestRecord(session.mockTestId, tenantId, schema);
    if (this.isSessionExpired(session.startedAt, mockTest.durationMinutes)) {
      await this.submitSession(sessionId, userId, tenantId, true);
      throw new BadRequestException('Session expired and was auto-submitted');
    }

    if (!(mockTest.questionIds || []).includes(dto.questionId)) {
      throw new BadRequestException('Question does not belong to this mock test');
    }

    const question = await this.questionRepo.findOne({
      where: { id: dto.questionId, tenantId },
      relations: ['options'],
    });
    if (!question) throw new NotFoundException(`Question ${dto.questionId} not found`);

    if (dto.selectedOptionIds?.length && question.type === QuestionType.INTEGER) {
      throw new BadRequestException('selectedOptionIds are not valid for integer questions');
    }

    let attempt = await this.attemptRepo.findOne({
      where: {
        testSessionId: sessionId,
        questionId: dto.questionId,
        studentId: student.id,
        tenantId,
      },
    });

    if (!attempt) {
      attempt = this.attemptRepo.create({
        tenantId,
        testSessionId: sessionId,
        studentId: student.id,
        questionId: dto.questionId,
      });
    }

    attempt.selectedOptionIds = dto.selectedOptionIds || [];
    attempt.integerAnswer = dto.integerResponse ?? null;
    attempt.timeSpentSeconds = dto.timeTakenSeconds;
    attempt.answeredAt = new Date();

    await this.attemptRepo.save(attempt);
    return { message: 'Answer saved' };
  }

  async submitSession(sessionId: string, userId: string, tenantId: string, auto = false) {
    const schema = await this.getMockTestSchema();
    const student = await this.getStudentByUserId(userId, tenantId);
    const existing = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId, studentId: student.id },
    });
    if (!existing) throw new NotFoundException(`Session ${sessionId} not found`);
    if (existing.status !== TestSessionStatus.IN_PROGRESS) {
      return this.getSessionResult(sessionId, { id: userId, role: UserRole.STUDENT }, tenantId);
    }

    const mockTest = await this.getMockTestRecord(existing.mockTestId, tenantId, schema);
    const now = new Date();

    // Capture BEFORE the transaction so we know if this is the first diagnostic completion
    const wasDiagnosticPending =
      mockTest.type === MockTestType.DIAGNOSTIC || !student.diagnosticCompleted;

    const newlyCompletedTopicIds: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      const questions = await manager.find(Question, {
        where: { tenantId, id: In(mockTest.questionIds || []) },
        relations: ['options', 'topic'],
      });
      const attempts = await manager.find(QuestionAttempt, {
        where: { tenantId, testSessionId: sessionId, studentId: student.id },
      });
      const attemptMap = new Map(attempts.map((attempt) => [attempt.questionId, attempt]));

      for (const questionId of mockTest.questionIds || []) {
        if (!attemptMap.has(questionId)) {
          const skipped = manager.create(QuestionAttempt, {
            tenantId,
            testSessionId: sessionId,
            studentId: student.id,
            questionId,
            selectedOptionIds: [],
            integerAnswer: null,
            timeSpentSeconds: 0,
            answeredAt: now,
          });
          const saved = await manager.save(skipped);
          attemptMap.set(questionId, saved);
        }
      }

      const allAttempts = Array.from(attemptMap.values());
      let totalScore = 0;
      let correctCount = 0;
      let wrongCount = 0;
      let skippedCount = 0;
      const errorBreakdown = { conceptual: 0, silly: 0, time: 0, guess: 0, skip: 0 };
      const topicStats = new Map<string, { marksAwarded: number; totalMarks: number }>();

      for (const question of questions) {
        const attempt = attemptMap.get(question.id);
        const graded = this.gradingService.gradeAttempt(question, attempt);
        attempt.isCorrect = graded.isCorrect;
        attempt.marksAwarded = graded.marksAwarded;
        attempt.errorType = graded.errorType;
        totalScore += graded.marksAwarded;

        if (graded.errorType) {
          errorBreakdown[graded.errorType] = (errorBreakdown[graded.errorType] || 0) + 1;
        }

        if (graded.errorType === ErrorType.SKIPPED) {
          skippedCount++;
        } else if (graded.isCorrect) {
          correctCount++;
        } else {
          wrongCount++;
        }

        const currentTopic = topicStats.get(question.topicId) || { marksAwarded: 0, totalMarks: 0 };
        currentTopic.marksAwarded += graded.marksAwarded;
        currentTopic.totalMarks += question.marksCorrect || 0;
        topicStats.set(question.topicId, currentTopic);
      }

      await manager.save(QuestionAttempt, allAttempts);

      existing.status = auto ? TestSessionStatus.AUTO_SUBMITTED : TestSessionStatus.SUBMITTED;
      existing.submittedAt = now;
      existing.totalScore = totalScore;
      existing.correctCount = correctCount;
      existing.wrongCount = wrongCount;
      existing.skippedCount = skippedCount;
      existing.timeDistribution = Object.fromEntries(
        allAttempts.map((attempt) => [attempt.questionId, attempt.timeSpentSeconds || 0]),
      );
      existing.errorBreakdown = errorBreakdown;
      await manager.save(TestSession, existing);

      // Mark diagnosticCompleted when:
      //   (a) the mock test is explicitly typed as DIAGNOSTIC, OR
      //   (b) the student hasn't yet completed their diagnostic — meaning whatever
      //       test they just submitted WAS their diagnostic (the UI falls back to
      //       the first published test when no DIAGNOSTIC-type test exists).
      if (mockTest.type === MockTestType.DIAGNOSTIC || !student.diagnosticCompleted) {
        if (!student.diagnosticCompleted) {
          student.diagnosticCompleted = true;
          await manager.save(Student, student);
        }

        // Upsert WeakTopic records based on diagnostic accuracy
        for (const [topicId, stats] of topicStats.entries()) {
          const accuracy = stats.totalMarks > 0 ? (stats.marksAwarded / stats.totalMarks) * 100 : 0;
          if (accuracy < 70) {
            const severity =
              accuracy < 30 ? WeakTopicSeverity.CRITICAL
              : accuracy < 50 ? WeakTopicSeverity.HIGH
              : WeakTopicSeverity.MEDIUM;

            const existing = await manager.findOne(WeakTopic, {
              where: { studentId: student.id, topicId },
            });
            if (existing) {
              existing.accuracy = accuracy;
              existing.severity = severity;
              existing.lastAttemptedAt = now;
              await manager.save(WeakTopic, existing);
            } else {
              await manager.save(
                manager.create(WeakTopic, {
                  studentId: student.id,
                  topicId,
                  accuracy,
                  severity,
                  wrongCount: allAttempts.filter(
                    (a) => questions.find((q) => q.id === a.questionId)?.topicId === topicId && !a.isCorrect,
                  ).length,
                  lastAttemptedAt: now,
                }),
              );
            }
          }
        }
      }

      for (const [topicId, stats] of topicStats.entries()) {
        const topic = questions.find((question) => question.topicId === topicId)?.topic;
        if (!topic) continue;

        const scorePercentage = stats.totalMarks > 0 ? (stats.marksAwarded / stats.totalMarks) * 100 : 0;
        const current = await manager.findOne(TopicProgress, {
          where: { tenantId, studentId: student.id, topicId },
        });
        const next = this.gradingService.computeTopicProgressUpdate(current, topic, scorePercentage, now);
        next.studentId = student.id;
        next.tenantId = tenantId;
        await manager.save(TopicProgress, next);

        // Track topics that newly transitioned to COMPLETED for gate-unlock side effects
        if (
          next.status === TopicStatus.COMPLETED &&
          current?.status !== TopicStatus.COMPLETED
        ) {
          newlyCompletedTopicIds.push(topicId);
        }
      }
    });

    // Unlock next topic in sequence for each topic that just passed its gate (fire-and-forget)
    for (const topicId of newlyCompletedTopicIds) {
      this.studyPlanService.onTopicGatePassed(student.id, topicId, tenantId).catch((err) =>
        this.logger.warn(`onTopicGatePassed failed for topic ${topicId}: ${err?.message}`),
      );
    }

    // Auto-generate study plan after diagnostic completion (fire-and-forget, non-blocking)
    if (wasDiagnosticPending) {
      this.studyPlanService.generatePlan(userId, tenantId, false).catch((err) =>
        this.logger.warn(`Auto study-plan generation failed for ${userId}: ${err?.message}`),
      );
    }

    return this.getSessionResult(sessionId, { id: userId, role: UserRole.STUDENT }, tenantId);
  }

  async getSessionById(id: string, user: any, tenantId: string) {
    const payload = await this.getSessionPayload(id, tenantId);
    await this.assertSessionReadAccess(payload.session, payload.mockTest, user, tenantId);
    return this.serializeSession(payload, user.role === UserRole.STUDENT);
  }

  async getSessionResult(id: string, user: any, tenantId: string) {
    const payload = await this.getSessionPayload(id, tenantId);
    await this.assertSessionReadAccess(payload.session, payload.mockTest, user, tenantId);

    const attempts = payload.attempts.map((attempt) => {
      const question = payload.questions.find((item) => item.id === attempt.questionId);
      return {
        ...attempt,
        question: user.role === UserRole.STUDENT ? this.sanitizeQuestionForStudent(question) : question,
        analysis: {
          isCorrect: attempt.isCorrect,
          marksAwarded: attempt.marksAwarded,
          errorType: attempt.errorType,
          timeTakenSeconds: attempt.timeSpentSeconds,
        },
      };
    });

    const totalEvaluated = (payload.session.correctCount || 0) + (payload.session.wrongCount || 0);
    return {
      ...this.serializeSession(payload, user.role === UserRole.STUDENT),
      attempts,
      totalScore: payload.session.totalScore || 0,
      accuracy: this.gradingService.computeAccuracy(payload.session.correctCount || 0, totalEvaluated),
      timeTaken: this.sumAttemptTimes(payload.attempts),
      errorBreakdown: payload.session.errorBreakdown || {
        conceptual: 0,
        silly: 0,
        time: 0,
        guess: 0,
        skip: 0,
      },
    };
  }

  async getSessions(query: SessionListQueryDto, user: any, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const schema = await this.getMockTestSchema();

    const qb = this.sessionRepo
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.mockTest', 'mockTest')
      .where('session.tenantId = :tenantId', { tenantId })
      .andWhere('session.deletedAt IS NULL');

    if (query.mockTestId) {
      qb.andWhere('session.mockTestId = :mockTestId', { mockTestId: query.mockTestId });
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      qb.andWhere('session.studentId = :studentId', { studentId: student.id });
    } else if (user.role === UserRole.TEACHER) {
      qb.andWhere('mockTest.createdBy = :createdBy', { createdBy: user.id });
      if (query.studentId) {
        qb.andWhere('session.studentId = :studentId', { studentId: query.studentId });
      }
    } else if (query.studentId) {
      qb.andWhere('session.studentId = :studentId', { studentId: query.studentId });
    }

    qb.orderBy('session.createdAt', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    let filtered = data;
    if (user.role === UserRole.TEACHER && schema.batchId) {
      const teacherBatchIds = await this.getTeacherBatchIds(user.id, tenantId);
      filtered = data.filter((session) => {
        const rawBatchId = (session.mockTest as any)?.batchId;
        return !rawBatchId || teacherBatchIds.includes(rawBatchId);
      });
    }

    return {
      data: filtered.map((session) => ({
        ...session,
        status: this.toApiSessionStatus(session.status),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async getTopicProgress(topicId: string, user: any, tenantId: string, studentIdOverride?: string) {
    const studentId = await this.resolveProgressStudentId(user, tenantId, studentIdOverride);
    const progress = await this.progressRepo.findOne({ where: { tenantId, topicId, studentId } });
    if (!progress) {
      return {
        topicId,
        studentId,
        gateStatus: 'locked',
        attemptsCount: 0,
        bestScore: 0,
      };
    }

    return this.serializeTopicProgress(progress);
  }

  // ─── Per-question accuracy stats across all sessions for a mock test ─────────

  async getMockTestQuestionStats(mockTestId: string, tenantId: string) {
    // Load the mock test to get question order / metadata
    const mockTest = await this.mockTestRepo.findOne({ where: { id: mockTestId, tenantId } });
    if (!mockTest) throw new NotFoundException('Mock test not found');

    // Load all completed sessions for this mock test
    const sessions = await this.sessionRepo.find({
      where: [
        { mockTestId, tenantId, status: TestSessionStatus.SUBMITTED },
        { mockTestId, tenantId, status: TestSessionStatus.AUTO_SUBMITTED },
      ],
      select: ['id'],
    });
    const sessionIds = sessions.map(s => s.id);
    if (!sessionIds.length) {
      // No submissions yet — return questions with zero stats
      const questions = await this.questionRepo.find({
        where: { id: In(mockTest.questionIds), tenantId },
        select: ['id', 'content', 'type', 'difficulty'],
      });
      return questions.map((q, i) => ({
        questionId: q.id,
        order: i + 1,
        content: q.content,
        type: q.type,
        difficulty: q.difficulty,
        totalAttempts: 0,
        correctCount: 0,
        accuracy: null,
        avgTimeSeconds: null,
      }));
    }

    // Load all attempts for those sessions
    const attempts = await this.attemptRepo.find({
      where: { testSessionId: In(sessionIds), tenantId },
      select: ['questionId', 'isCorrect', 'timeSpentSeconds'],
    });

    // Aggregate by questionId
    const statsMap: Record<string, { correct: number; total: number; totalTime: number }> = {};
    for (const a of attempts) {
      if (!statsMap[a.questionId]) statsMap[a.questionId] = { correct: 0, total: 0, totalTime: 0 };
      statsMap[a.questionId].total++;
      if (a.isCorrect) statsMap[a.questionId].correct++;
      statsMap[a.questionId].totalTime += a.timeSpentSeconds ?? 0;
    }

    // Load question details in order of the mock test questionIds
    const questions = await this.questionRepo.find({
      where: { id: In(mockTest.questionIds), tenantId },
      select: ['id', 'content', 'type', 'difficulty'],
    });
    const questionMap: Record<string, any> = {};
    for (const q of questions) questionMap[q.id] = q;

    return mockTest.questionIds.map((qId, i) => {
      const q = questionMap[qId];
      const s = statsMap[qId];
      return {
        questionId: qId,
        order: i + 1,
        content: q?.content ?? '',
        type: q?.type ?? '',
        difficulty: q?.difficulty ?? '',
        totalAttempts: s?.total ?? 0,
        correctCount: s?.correct ?? 0,
        accuracy: s?.total ? Math.round((s.correct / s.total) * 100) : null,
        avgTimeSeconds: s?.total ? Math.round(s.totalTime / s.total) : null,
      };
    });
  }

  async getProgressOverview(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const rows = await this.progressRepo.find({
      where: { tenantId, studentId: student.id },
    });

    // Return flat array matching frontend TopicProgress interface
    return rows.map((p) => ({
      topicId: p.topicId,
      status: p.status,           // 'locked' | 'unlocked' | 'in_progress' | 'completed'
      bestAccuracy: p.bestAccuracy ?? 0,
      attemptCount: p.attemptCount ?? 0,
    }));
  }

  // ─── Full progress report: subject → chapter → topic with all dimensions ─────

  async getProgressReport(user: any, tenantId: string, studentIdOverride?: string) {
    const studentId = await this.resolveProgressStudentId(user, tenantId, studentIdOverride);

    // 1. Content tree
    const subjects = await this.subjectRepo.find({
      where: { tenantId },
      order: { sortOrder: 'ASC', name: 'ASC' } as any,
    });
    const subjectIds = subjects.map(s => s.id);
    if (!subjectIds.length) return this.emptyProgressReport(studentId);

    const chapters = await this.chapterRepo.find({
      where: { subjectId: In(subjectIds) },
      order: { sortOrder: 'ASC', name: 'ASC' } as any,
    });
    const chapterIds = chapters.map(c => c.id);
    if (!chapterIds.length) return this.emptyProgressReport(studentId);

    const topics = await this.topicRepo.find({
      where: { chapterId: In(chapterIds) },
      order: { sortOrder: 'ASC', name: 'ASC' } as any,
    });
    const topicIds = topics.map(t => t.id);

    // 2. Quiz gate progress (TopicProgress rows)
    const progressRows = topicIds.length
      ? await this.progressRepo.find({ where: { studentId, tenantId } })
      : [];
    const progressMap = new Map(progressRows.map(p => [p.topicId, p]));

    // 3. Lecture watch progress per topic (avg of all lectures under topic)
    const lectureRows = topicIds.length
      ? await this.dataSource.query(`
          SELECT l.topic_id,
                 ROUND(AVG(lp.watch_percentage)::numeric, 1)::float AS avg_watch,
                 BOOL_OR(lp.is_completed) AS any_completed
          FROM lecture_progress lp
          JOIN lectures l ON l.id = lp.lecture_id
          WHERE lp.student_id = $1 AND l.tenant_id = $2 AND l.topic_id = ANY($3)
          GROUP BY l.topic_id
        `, [studentId, tenantId, topicIds])
      : [];
    const lectureMap = new Map<string, { avg_watch: number; any_completed: boolean }>(
      lectureRows.map((r: any) => [r.topic_id, r]),
    );

    // 4. PYQ attempts per topic
    const pyqRows = topicIds.length
      ? await this.dataSource.query(`
          SELECT q.topic_id,
                 COUNT(*)::int AS attempted,
                 SUM(CASE WHEN pa.is_correct THEN 1 ELSE 0 END)::int AS correct
          FROM pyq_attempts pa
          JOIN questions q ON q.id = pa.question_id
          WHERE pa.student_id = $1 AND pa.tenant_id = $2 AND q.topic_id = ANY($3)
          GROUP BY q.topic_id
        `, [studentId, tenantId, topicIds])
      : [];
    const pyqMap = new Map<string, { attempted: number; correct: number }>(
      pyqRows.map((r: any) => [r.topic_id, r]),
    );

    // 5. AI study session per topic (latest)
    const aiRows = topicIds.length
      ? await this.dataSource.query(`
          SELECT DISTINCT ON (topic_id) topic_id,
                 (completed_at IS NOT NULL) AS completed
          FROM ai_study_sessions
          WHERE student_id = $1 AND tenant_id = $2 AND topic_id = ANY($3)
          ORDER BY topic_id, created_at DESC
        `, [studentId, tenantId, topicIds])
      : [];
    const aiMap = new Map<string, { completed: boolean }>(
      aiRows.map((r: any) => [r.topic_id, r]),
    );

    // 6. Build lookup maps
    const subjectChaptersMap = new Map<string, typeof chapters>();
    for (const c of chapters) {
      if (!subjectChaptersMap.has(c.subjectId)) subjectChaptersMap.set(c.subjectId, []);
      subjectChaptersMap.get(c.subjectId)!.push(c);
    }
    const chapterTopicsMap = new Map<string, typeof topics>();
    for (const t of topics) {
      if (!chapterTopicsMap.has(t.chapterId)) chapterTopicsMap.set(t.chapterId, []);
      chapterTopicsMap.get(t.chapterId)!.push(t);
    }

    // 7. Assemble tree + summary
    let totalTopics = 0, completedTopics = 0, inProgressTopics = 0;
    let totalPYQAttempted = 0, totalPYQCorrect = 0, totalLecturesCompleted = 0;
    let accuracySum = 0, accuracyCount = 0;

    const subjectsResult = subjects.map(s => {
      const chaps = subjectChaptersMap.get(s.id) ?? [];
      let sTopics = 0, sCompleted = 0, sAccSum = 0, sAccCount = 0;

      const chaptersResult = chaps.map(c => {
        const tops = chapterTopicsMap.get(c.id) ?? [];
        let cTopics = 0, cCompleted = 0, cAccSum = 0, cAccCount = 0;

        const topicsResult = tops.map(t => {
          totalTopics++; sTopics++; cTopics++;
          const prog = progressMap.get(t.id);
          const lec = lectureMap.get(t.id);
          const pyq = pyqMap.get(t.id);
          const ai = aiMap.get(t.id);
          const status = prog?.status ?? TopicStatus.LOCKED;
          if (status === TopicStatus.COMPLETED) { completedTopics++; sCompleted++; cCompleted++; }
          else if (status === TopicStatus.IN_PROGRESS) inProgressTopics++;
          const accuracy = prog?.bestAccuracy ?? 0;
          if (prog && accuracy > 0) {
            accuracySum += accuracy; accuracyCount++;
            sAccSum += accuracy; sAccCount++;
            cAccSum += accuracy; cAccCount++;
          }
          const pyqAttempted = pyq ? Number(pyq.attempted) : 0;
          const pyqCorrect   = pyq ? Number(pyq.correct)   : 0;
          totalPYQAttempted += pyqAttempted;
          totalPYQCorrect   += pyqCorrect;
          if (lec?.any_completed) totalLecturesCompleted++;
          return {
            topicId: t.id,
            topicName: t.name,
            status,
            bestAccuracy: accuracy,
            attemptCount: prog?.attemptCount ?? 0,
            gatePassPercentage: (t as any).gatePassPercentage ?? 70,
            completedAt: prog?.completedAt ?? null,
            lecture: lec ? {
              avgWatchPct: lec.avg_watch ?? 0,
              anyCompleted: !!lec.any_completed,
            } : null,
            pyq: pyq ? {
              attempted: pyqAttempted,
              correct: pyqCorrect,
              accuracy: pyqAttempted > 0 ? Math.round((pyqCorrect / pyqAttempted) * 100) : 0,
            } : null,
            aiSession: ai ? { completed: !!ai.completed } : null,
          };
        });

        return {
          chapterId: c.id,
          chapterName: c.name,
          topicsTotal: cTopics,
          topicsCompleted: cCompleted,
          overallAccuracy: cAccCount > 0 ? Math.round(cAccSum / cAccCount) : 0,
          topics: topicsResult,
        };
      });

      return {
        subjectId: s.id,
        subjectName: s.name,
        examTarget: (s as any).examTarget ?? null,
        colorCode: (s as any).colorCode ?? null,
        topicsTotal: sTopics,
        topicsCompleted: sCompleted,
        overallAccuracy: sAccCount > 0 ? Math.round(sAccSum / sAccCount) : 0,
        chapters: chaptersResult,
      };
    });

    return {
      studentId,
      summary: {
        totalTopics,
        completedTopics,
        inProgressTopics,
        lockedTopics: totalTopics - completedTopics - inProgressTopics,
        overallAccuracy: accuracyCount > 0 ? Math.round(accuracySum / accuracyCount) : 0,
        totalPYQAttempted,
        pyqAccuracy: totalPYQAttempted > 0 ? Math.round((totalPYQCorrect / totalPYQAttempted) * 100) : 0,
        lecturesCompleted: totalLecturesCompleted,
      },
      subjects: subjectsResult,
    };
  }

  private emptyProgressReport(studentId: string) {
    return {
      studentId,
      summary: {
        totalTopics: 0, completedTopics: 0, inProgressTopics: 0, lockedTopics: 0,
        overallAccuracy: 0, totalPYQAttempted: 0, pyqAccuracy: 0, lecturesCompleted: 0,
      },
      subjects: [],
    };
  }

  private async getSessionPayload(id: string, tenantId: string) {
    const session = await this.sessionRepo.findOne({
      where: { id, tenantId },
      relations: ['mockTest'],
    });
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    const schema = await this.getMockTestSchema();
    const mockTest = await this.getMockTestRecord(session.mockTestId, tenantId, schema);
    const attempts = await this.attemptRepo.find({
      where: { tenantId, testSessionId: id },
      order: { createdAt: 'ASC' },
    });
    const questions = await this.questionRepo.find({
      where: { tenantId, id: In(mockTest.questionIds || []) },
      relations: ['options', 'topic'],
    });

    return { session, mockTest, attempts, questions };
  }

  private serializeSession(
    payload: { session: TestSession; mockTest: any; attempts: QuestionAttempt[]; questions: Question[] },
    studentView: boolean,
  ) {
    return {
      ...payload.session,
      status: this.toApiSessionStatus(payload.session.status),
      mockTest: payload.mockTest,
      attempts: payload.attempts,
      questions: this.sortQuestionsByIds(
        payload.questions.map((question) => (studentView ? this.sanitizeQuestionForStudent(question) : question)),
        payload.mockTest.questionIds || [],
      ),
      totalCorrect: payload.session.correctCount || 0,
      totalWrong: payload.session.wrongCount || 0,
      totalSkipped: payload.session.skippedCount || 0,
      timeTakenSeconds: this.sumAttemptTimes(payload.attempts),
    };
  }

  private sanitizeQuestionForStudent(question: Question) {
    return {
      ...question,
      integerAnswer: undefined,
      options: (question.options || []).map((option) => ({
        ...option,
        isCorrect: null,
      })),
    };
  }

  private sortQuestionsByIds(questions: any[], questionIds: string[]) {
    const map = new Map(questions.map((question) => [question.id, question]));
    return questionIds.map((id) => map.get(id)).filter(Boolean);
  }

  private async loadAndValidateQuestions(questionIds: string[], tenantId: string, topicId?: string) {
    const uniqueQuestionIds = [...new Set(questionIds)];
    const questions = await this.questionRepo.find({
      where: { tenantId, id: In(uniqueQuestionIds), isActive: true },
      relations: ['options', 'topic'],
    });

    if (questions.length !== uniqueQuestionIds.length) {
      throw new BadRequestException('One or more questionIds are invalid for this tenant');
    }

    if (topicId && questions.some((question) => question.topicId !== topicId)) {
      throw new BadRequestException('All questions must belong to the provided topicId');
    }

    return questions;
  }

  // ─── Diagnostic ────────────────────────────────────────────────────────────

  async getDiagnosticStatus(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    return { completed: student.diagnosticCompleted };
  }

  async generateDiagnosticSession(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);

    // If already done, return the existing completed session so the UI can redirect
    if (student.diagnosticCompleted) {
      const existing = await this.sessionRepo.findOne({
        where: { tenantId, studentId: student.id },
        order: { createdAt: 'DESC' },
      });
      if (existing) {
        const payload = await this.getSessionPayload(existing.id, tenantId);
        return { alreadyCompleted: true, session: this.serializeSession(payload, true) };
      }
      return { alreadyCompleted: true, session: null };
    }

    // --- Find student's batch via enrollment ---
    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
    const batchId = enrollments[0]?.batchId ?? null;

    // --- Get subjects for this examTarget (BOTH → include JEE + NEET) ---
    const examTargets =
      student.examTarget === ExamTarget.BOTH
        ? [ExamTarget.JEE, ExamTarget.NEET]
        : [student.examTarget];

    const subjects = await this.subjectRepo
      .createQueryBuilder('s')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.examTarget IN (:...examTargets)', { examTargets })
      .andWhere('s.isActive = true')
      .getMany();
    if (!subjects.length) {
      throw new BadRequestException(
        `No subjects found for exam target "${student.examTarget}". Please ask your admin to add subjects.`,
      );
    }

    const subjectIds = subjects.map((s) => s.id);

    // --- Get all chapters for those subjects ---
    const chapters = await this.chapterRepo.find({
      where: { tenantId, isActive: true },
    });
    const relevantChapters = chapters.filter((c) => subjectIds.includes(c.subjectId));
    const chapterIds = relevantChapters.map((c) => c.id);

    if (!chapterIds.length) {
      throw new BadRequestException(
        'No chapters found for your subjects. Please ask your admin to add chapters.',
      );
    }

    // --- Get all topics for those chapters ---
    const topics = await this.topicRepo.find({
      where: { tenantId, isActive: true },
    });
    const relevantTopics = topics.filter((t) => chapterIds.includes(t.chapterId));
    const topicIds = relevantTopics.map((t) => t.id);

    if (!topicIds.length) {
      throw new BadRequestException(
        'No topics found for your subjects. Please ask your admin to add topics.',
      );
    }

    // --- Sample questions: 40% easy, 40% medium, 20% hard, MCQ only ---
    const TARGET_TOTAL = 40;
    const targetEasy   = Math.round(TARGET_TOTAL * 0.4);
    const targetMedium = Math.round(TARGET_TOTAL * 0.4);
    const targetHard   = TARGET_TOTAL - targetEasy - targetMedium;

    const fetchByDifficulty = async (difficulty: string, limit: number) =>
      this.questionRepo
        .createQueryBuilder('q')
        .where('q.tenantId = :tenantId', { tenantId })
        .andWhere('q.topicId IN (:...topicIds)', { topicIds })
        .andWhere('q.type IN (:...types)', { types: [QuestionType.MCQ_SINGLE, QuestionType.MCQ_MULTI] })
        .andWhere('q.difficulty = :difficulty', { difficulty })
        .andWhere('q.deletedAt IS NULL')
        .orderBy('RANDOM()')
        .limit(limit)
        .getMany();

    const [easyQs, mediumQs, hardQs] = await Promise.all([
      fetchByDifficulty(DifficultyLevel.EASY, targetEasy),
      fetchByDifficulty(DifficultyLevel.MEDIUM, targetMedium),
      fetchByDifficulty(DifficultyLevel.HARD, targetHard),
    ]);

    const allQuestions = [...easyQs, ...mediumQs, ...hardQs];

    // If question bank is sparse, fall back to any MCQ across all difficulties
    if (allQuestions.length < 5) {
      const fallback = await this.questionRepo
        .createQueryBuilder('q')
        .where('q.tenantId = :tenantId', { tenantId })
        .andWhere('q.topicId IN (:...topicIds)', { topicIds })
        .andWhere('q.type IN (:...types)', { types: [QuestionType.MCQ_SINGLE, QuestionType.MCQ_MULTI] })
        .andWhere('q.deletedAt IS NULL')
        .orderBy('RANDOM()')
        .limit(TARGET_TOTAL)
        .getMany();

      if (fallback.length < 1) {
        this.logger.log(`No questions in bank for tenant ${tenantId} — generating via AI for ${relevantTopics.length} topics`);
        const aiQuestions = await this.generateAiQuestionsForDiagnostic(relevantTopics, tenantId);
        if (aiQuestions.length < 1) {
          throw new BadRequestException(
            'Could not generate diagnostic questions. Please ensure your subjects and topics are configured, then try again.',
          );
        }
        allQuestions.length = 0;
        allQuestions.push(...aiQuestions);
      } else {
        allQuestions.length = 0;
        allQuestions.push(...fallback);
      }
    }

    // Shuffle final set
    allQuestions.sort(() => Math.random() - 0.5);

    const totalMarks = allQuestions.length; // 1 mark per question

    // --- Create the MockTest ---
    const mockTest = await this.mockTestRepo.save(
      this.mockTestRepo.create({
        tenantId,
        title: `Diagnostic Test — ${student.examTarget.toUpperCase()}`,
        type: MockTestType.DIAGNOSTIC,
        totalMarks,
        durationMinutes: 45,
        questionIds: allQuestions.map((q) => q.id),
        isActive: true,
        createdBy: userId,
      }),
    );

    const schema = await this.getMockTestSchema();
    await this.updateOptionalMockTestColumns(
      mockTest.id,
      {
        batchId: batchId ?? null,
        isPublished: true,
        shuffleQuestions: true,
        showAnswersAfterSubmit: true,
        allowReattempt: false,
      },
      schema,
    );

    // --- Create the session directly (bypass published/enrollment guards — diagnostic is special) ---
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        tenantId,
        studentId: student.id,
        mockTestId: mockTest.id,
        status: TestSessionStatus.IN_PROGRESS,
        startedAt: new Date(),
      }),
    );

    const payload = await this.getSessionPayload(session.id, tenantId);
    return { alreadyCompleted: false, session: this.serializeSession(payload, true) };
  }

  private async validateBatchAccess(batchId: string, user: any, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    if (user.role === UserRole.TEACHER && batch.teacherId !== user.id) {
      const subjectAssignment = await this.batchSubjectTeacherRepo.findOne({
        where: { batchId, teacherId: user.id, tenantId },
      });
      if (!subjectAssignment) {
        throw new ForbiddenException('You are not assigned to this batch');
      }
    }

    return batch;
  }

  private async getStudentByUserId(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  private async assertStudentEnrollment(studentId: string, batchId: string, tenantId: string) {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { tenantId, studentId, batchId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) {
      throw new ForbiddenException('Student is not enrolled in the test batch');
    }
  }

  private async assertMockTestReadAccess(mockTest: any, user: any, tenantId: string, schema: MockTestSchema) {
    if (user.role === UserRole.STUDENT) {
      if (schema.isPublished && !mockTest.isPublished) {
        throw new ForbiddenException('This test is not published');
      }
      if (schema.batchId && mockTest.batchId) {
        const batchIds = await this.getStudentBatchIds(user.id, tenantId);
        if (!batchIds.includes(mockTest.batchId)) {
          throw new ForbiddenException('You are not enrolled in this test batch');
        }
      }
    }

    if (user.role === UserRole.TEACHER && schema.batchId && mockTest.batchId) {
      const batch = await this.batchRepo.findOne({ where: { id: mockTest.batchId, tenantId } });
      if (batch && batch.teacherId !== user.id && mockTest.createdBy !== user.id) {
        throw new ForbiddenException('You do not have access to this test');
      }
    }
  }

  private async assertMockTestWriteAccess(mockTest: MockTest, user: any) {
    if (user.role === UserRole.TEACHER && mockTest.createdBy !== user.id) {
      throw new ForbiddenException('Teachers can only modify their own mock tests');
    }
  }

  private async assertSessionReadAccess(session: TestSession, mockTest: any, user: any, tenantId: string) {
    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      if (session.studentId !== student.id) {
        throw new ForbiddenException('You can only access your own sessions');
      }
      return;
    }

    if (user.role === UserRole.TEACHER) {
      const batchIds = await this.getTeacherBatchIds(user.id, tenantId);
      if (mockTest.batchId && !batchIds.includes(mockTest.batchId) && mockTest.createdBy !== user.id) {
        throw new ForbiddenException('You do not have access to this session');
      }
    }
  }

  private async resolveProgressStudentId(user: any, tenantId: string, studentIdOverride?: string) {
    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      return student.id;
    }

    if (!studentIdOverride) {
      throw new BadRequestException('studentId is required for non-student users');
    }

    return studentIdOverride;
  }

  private serializeTopicProgress(progress: TopicProgress) {
    return {
      id: progress.id,
      topicId: progress.topicId,
      studentId: progress.studentId,
      gateStatus: progress.status === TopicStatus.COMPLETED ? 'passed' : 'locked',
      attemptsCount: progress.attemptCount || 0,
      bestScore: progress.bestAccuracy || 0,
      lastAttemptAt: progress.updatedAt,
    };
  }

  private async getStudentBatchIds(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    return enrollments.map((enrollment) => enrollment.batchId);
  }

  private async getTeacherBatchIds(userId: string, tenantId: string) {
    const [primaryBatches, subjectAssignments] = await Promise.all([
      this.batchRepo.find({ where: { tenantId, teacherId: userId } }),
      this.batchSubjectTeacherRepo.find({ where: { tenantId, teacherId: userId } }),
    ]);
    const ids = new Set([
      ...primaryBatches.map((b) => b.id),
      ...subjectAssignments.map((a) => a.batchId),
    ]);
    return [...ids];
  }

  private isSessionExpired(startedAt: Date, durationMinutes: number) {
    const expiresAt = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
    return Date.now() > expiresAt;
  }

  private sumAttemptTimes(attempts: QuestionAttempt[]) {
    return attempts.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds || 0), 0);
  }

  private toApiSessionStatus(status: TestSessionStatus) {
    if (status === TestSessionStatus.IN_PROGRESS) return 'in_progress';
    if (status === TestSessionStatus.ABANDONED) return 'abandoned';
    return 'completed';
  }

  private getMockTestSelectColumns(schema: MockTestSchema) {
    return [
      'mt.id',
      'mt.tenant_id AS "tenantId"',
      'mt.title',
      'mt.type',
      'mt.total_marks AS "totalMarks"',
      'mt.duration_minutes AS "durationMinutes"',
      'mt.question_ids AS "questionIds"',
      'mt.scheduled_at AS "scheduledAt"',
      'mt.created_by AS "createdBy"',
      'mt.created_at AS "createdAt"',
      'mt.updated_at AS "updatedAt"',
      schema.batchId ? 'mt.batch_id AS "batchId"' : 'NULL::uuid AS "batchId"',
      schema.topicId ? 'mt.topic_id AS "topicId"' : 'NULL::uuid AS "topicId"',
      schema.passingMarks ? 'mt.passing_marks AS "passingMarks"' : 'NULL::int AS "passingMarks"',
      schema.isPublished ? 'mt.is_published AS "isPublished"' : 'false AS "isPublished"',
      schema.shuffleQuestions ? 'mt.shuffle_questions AS "shuffleQuestions"' : 'false AS "shuffleQuestions"',
      schema.showAnswersAfterSubmit ? 'mt.show_answers_after_submit AS "showAnswersAfterSubmit"' : 'true AS "showAnswersAfterSubmit"',
      schema.allowReattempt ? 'mt.allow_reattempt AS "allowReattempt"' : 'false AS "allowReattempt"',
    ].join(', ');
  }

  private async getMockTestRecord(id: string, tenantId: string, schema: MockTestSchema) {
    const rows = await this.dataSource.query(
      `
        SELECT ${this.getMockTestSelectColumns(schema)}
        FROM mock_tests mt
        WHERE mt.id = $1 AND mt.tenant_id = $2 AND mt.deleted_at IS NULL
      `,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException(`Mock test ${id} not found`);
    return rows[0];
  }

  private async updateOptionalMockTestColumns(
    id: string,
    values: {
      batchId?: string | null;
      topicId?: string | null;
      passingMarks?: number | null;
      isPublished?: boolean;
      shuffleQuestions?: boolean;
      showAnswersAfterSubmit?: boolean;
      allowReattempt?: boolean;
    },
    schema: MockTestSchema,
  ) {
    const updates: string[] = [];
    const params: any[] = [id];
    let index = 2;

    if (schema.batchId && values.batchId !== undefined) {
      updates.push(`batch_id = $${index++}`);
      params.push(values.batchId);
    }
    if (schema.topicId && values.topicId !== undefined) {
      updates.push(`topic_id = $${index++}`);
      params.push(values.topicId);
    }
    if (schema.passingMarks && values.passingMarks !== undefined) {
      updates.push(`passing_marks = $${index++}`);
      params.push(values.passingMarks);
    }
    if (schema.isPublished && values.isPublished !== undefined) {
      updates.push(`is_published = $${index++}`);
      params.push(values.isPublished);
    }
    if (schema.shuffleQuestions && values.shuffleQuestions !== undefined) {
      updates.push(`shuffle_questions = $${index++}`);
      params.push(values.shuffleQuestions);
    }
    if (schema.showAnswersAfterSubmit && values.showAnswersAfterSubmit !== undefined) {
      updates.push(`show_answers_after_submit = $${index++}`);
      params.push(values.showAnswersAfterSubmit);
    }
    if (schema.allowReattempt && values.allowReattempt !== undefined) {
      updates.push(`allow_reattempt = $${index++}`);
      params.push(values.allowReattempt);
    }

    if (!updates.length) return;

    await this.dataSource.query(`UPDATE mock_tests SET ${updates.join(', ')} WHERE id = $1`, params);
  }

  private async getMockTestSchema(): Promise<MockTestSchema> {
    if (!this.mockTestSchemaPromise) {
      this.mockTestSchemaPromise = this.dataSource
        .query(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'mock_tests'
          `,
        )
        .then((rows: Array<{ column_name: string }>) => {
          const set = new Set(rows.map((row) => row.column_name));
          return {
            batchId: set.has('batch_id'),
            topicId: set.has('topic_id'),
            passingMarks: set.has('passing_marks'),
            isPublished: set.has('is_published'),
            shuffleQuestions: set.has('shuffle_questions'),
            showAnswersAfterSubmit: set.has('show_answers_after_submit'),
            allowReattempt: set.has('allow_reattempt'),
          };
        })
        .catch((error) => {
          this.logger.warn(`Failed to inspect mock_tests schema: ${error.message}`);
          return {
            batchId: false,
            topicId: false,
            passingMarks: false,
            isPublished: false,
            shuffleQuestions: false,
            showAnswersAfterSubmit: false,
            allowReattempt: false,
          };
        });
    }

    return this.mockTestSchemaPromise;
  }

  // ── AI Question Generation for Diagnostic ────────────────────────────────────

  private async generateAiQuestionsForDiagnostic(
    topics: Topic[],
    tenantId: string,
  ): Promise<Question[]> {
    const MAX_TOPICS = 10;
    const QUESTIONS_PER_TOPIC = 4;
    // 40% easy / 40% medium / 20% hard cycling across selected topics
    const difficultyPattern: DifficultyLevel[] = [
      DifficultyLevel.EASY, DifficultyLevel.MEDIUM, DifficultyLevel.HARD,
      DifficultyLevel.MEDIUM, DifficultyLevel.EASY, DifficultyLevel.MEDIUM,
      DifficultyLevel.HARD, DifficultyLevel.EASY, DifficultyLevel.MEDIUM, DifficultyLevel.EASY,
    ];

    // Select representative topics spread across all available topics
    let selected: Topic[];
    if (topics.length <= MAX_TOPICS) {
      selected = topics;
    } else {
      const step = Math.floor(topics.length / MAX_TOPICS);
      selected = Array.from({ length: MAX_TOPICS }, (_, i) => topics[i * step]);
    }

    this.logger.log(`Generating AI questions for ${selected.length} topics`);

    // Call AI for all topics in parallel
    const results = await Promise.allSettled(
      selected.map(async (topic, idx) => {
        const difficulty = difficultyPattern[idx % difficultyPattern.length];
        const rawQs = await this.aiBridgeService.generateQuestionsFromTopic(
          {
            topicId: topic.id,
            topicName: topic.name,
            count: QUESTIONS_PER_TOPIC,
            difficulty,
            type: 'mcq_single',
          },
          tenantId,
        );
        return { topic, rawQs: rawQs as any[], difficulty };
      }),
    );

    // Persist each generated question + options
    const saved: Question[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value.rawQs)) continue;
      const { topic, rawQs, difficulty } = r.value;

      for (const rq of rawQs) {
        if (!rq?.content) continue;
        try {
          const q = await this.dataSource.transaction(async (mgr) => {
            const question = mgr.create(Question, {
              tenantId,
              topicId: topic.id,
              content: rq.content,
              type: QuestionType.MCQ_SINGLE,
              difficulty,
              source: QuestionSource.AI_GENERATED,
              solutionText: rq.explanation ?? null,
              marksCorrect: 4,
              marksWrong: -1,
              isActive: true,
              isVerified: false,
            });
            const savedQ = await mgr.save(Question, question);

            if (Array.isArray(rq.options) && rq.options.length > 0) {
              const opts = (rq.options as any[]).map((o, i) =>
                mgr.create(QuestionOption, {
                  questionId: savedQ.id,
                  optionLabel: o.label ?? String.fromCharCode(65 + i),
                  content: o.content ?? String(o),
                  isCorrect: o.isCorrect ?? false,
                  sortOrder: i,
                }),
              );
              await mgr.save(QuestionOption, opts);
            }

            return mgr.findOne(Question, {
              where: { id: savedQ.id },
              relations: ['options', 'topic'],
            });
          });
          if (q) saved.push(q);
        } catch (err) {
          this.logger.warn(
            `Failed to save AI question for topic "${topic.name}": ${(err as Error).message}`,
          );
        }
      }
    }

    this.logger.log(`AI generated and saved ${saved.length} questions for diagnostic`);
    return saved;
  }
}
