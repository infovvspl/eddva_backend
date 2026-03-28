import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { randomBytes, randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { Batch, BatchStatus, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';
import { Doubt, DoubtStatus, Lecture, LectureProgress } from '../../database/entities/learning.entity';
import { Student, ExamTarget, StudentClass, ExamYear, SubscriptionPlan } from '../../database/entities/student.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { EngagementLog, WeakTopic } from '../../database/entities/analytics.entity';
import { Topic } from '../../database/entities/subject.entity';

import {
  AttendanceQueryDto,
  BatchListQueryDto,
  CreateBatchDto,
  FlagReason,
  FlagStudentDto,
  RosterQueryDto,
  UpdateBatchDto,
} from './dto/batch.dto';
import { AssignSubjectTeacherDto, BulkEnrollDto, BulkCreateBatchStudentsDto, CreateBatchStudentDto, EnrollStudentDto } from './dto/enrollment.dto';

type MockTestBatchSchema = { batchId: boolean };

@Injectable()
export class BatchService {
  private mockTestBatchSchemaPromise: Promise<MockTestBatchSchema> | null = null;
  private readonly logger = new Logger(BatchService.name);

  constructor(
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(LectureProgress)
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(Doubt)
    private readonly doubtRepo: Repository<Doubt>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(EngagementLog)
    private readonly engagementLogRepo: Repository<EngagementLog>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async createBatch(dto: CreateBatchDto, tenantId: string) {
    if (dto.teacherId) {
      await this.validateTeacher(dto.teacherId, tenantId);
    }

    const batch = this.batchRepo.create({
      tenantId,
      name: dto.name,
      examTarget: dto.examTarget,
      class: dto.class,
      teacherId: dto.teacherId ?? null,
      maxStudents: dto.maxStudents ?? 60,
      feeAmount: dto.feeAmount ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      status: BatchStatus.ACTIVE,
    });

    return this.batchRepo.save(batch);
  }

  async getBatches(query: BatchListQueryDto, user: any, tenantId: string) {
    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.teacher', 'teacher')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.deletedAt IS NULL');

    if (query.status) qb.andWhere('batch.status = :status', { status: query.status });
    if (query.examTarget) qb.andWhere('batch.examTarget = :examTarget', { examTarget: query.examTarget });

    if (user.role === UserRole.TEACHER) {
      // Include batches assigned directly OR via subject-teacher assignment
      const subjectBatchIds = await this.batchSubjectTeacherRepo
        .find({ where: { teacherId: user.id, tenantId } })
        .then(rows => rows.map(r => r.batchId));

      if (subjectBatchIds.length > 0) {
        qb.andWhere('(batch.teacherId = :teacherId OR batch.id IN (:...subjectBatchIds))', {
          teacherId: user.id,
          subjectBatchIds,
        });
      } else {
        qb.andWhere('batch.teacherId = :teacherId', { teacherId: user.id });
      }
    } else if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      const enrollments = await this.enrollmentRepo.find({
        where: { tenantId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
      });
      const batchIds = enrollments.map((enrollment) => enrollment.batchId);
      if (!batchIds.length) return [];
      qb.andWhere('batch.id IN (:...batchIds)', { batchIds });
    }

    return qb.orderBy('batch.createdAt', 'DESC').getMany();
  }

  async getBatchById(id: string, user: any, tenantId: string) {
    const batch = await this.batchRepo.findOne({
      where: { id, tenantId },
      relations: ['teacher'],
    });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);
    await this.assertBatchAccess(batch, user, tenantId);

    const studentCount = await this.enrollmentRepo.count({
      where: { tenantId, batchId: id, status: EnrollmentStatus.ACTIVE },
    });

    return {
      ...batch,
      teacherName: batch.teacher?.fullName || null,
      studentCount,
    };
  }

  async updateBatch(id: string, dto: UpdateBatchDto, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);

    if (dto.teacherId) {
      await this.validateTeacher(dto.teacherId, tenantId);
    }

    Object.assign(batch, dto);
    return this.batchRepo.save(batch);
  }

  async getDashboardStats(tenantId: string) {
    const [
      batches,
      totalTeachers,
      activeTeachers,
      pendingTeachers,
      totalLectures,
      openDoubts,
      totalTestSessions,
    ] = await Promise.all([
      this.batchRepo.find({
        where: { tenantId },
        relations: ['teacher'],
        order: { createdAt: 'DESC' },
      }),
      this.userRepo.count({ where: { tenantId, role: UserRole.TEACHER } }),
      this.userRepo.count({ where: { tenantId, role: UserRole.TEACHER, status: UserStatus.ACTIVE } }),
      this.userRepo.count({ where: { tenantId, role: UserRole.TEACHER, status: UserStatus.PENDING_VERIFICATION } }),
      this.lectureRepo.count({ where: { tenantId } }),
      this.doubtRepo.count({ where: { tenantId, status: DoubtStatus.OPEN } }),
      this.sessionRepo.count({ where: { tenantId } }),
    ]);

    const batchIds = batches.map(b => b.id);
    const totalStudents = batchIds.length
      ? await this.enrollmentRepo.count({ where: { tenantId, status: EnrollmentStatus.ACTIVE } })
      : 0;

    const activeBatches = batches.filter(b => b.status === BatchStatus.ACTIVE);

    // Recent batches (top 5) with student count
    const recentBatchesWithCount = await Promise.all(
      batches.slice(0, 6).map(async b => {
        const studentCount = await this.enrollmentRepo.count({
          where: { batchId: b.id, status: EnrollmentStatus.ACTIVE },
        });
        return {
          id: b.id,
          name: b.name,
          examTarget: b.examTarget,
          class: b.class,
          status: b.status,
          teacherName: b.teacher?.fullName || null,
          studentCount,
          maxStudents: b.maxStudents,
          startDate: b.startDate,
          endDate: b.endDate,
        };
      }),
    );

    return {
      stats: {
        totalBatches: batches.length,
        activeBatches: activeBatches.length,
        totalStudents,
        totalTeachers,
        activeTeachers,
        pendingTeachers,
        totalLectures,
        openDoubts,
        totalTestSessions,
      },
      recentBatches: recentBatchesWithCount,
    };
  }

  async deleteBatch(id: string, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);

    const activeCount = await this.enrollmentRepo.count({
      where: { tenantId, batchId: id, status: EnrollmentStatus.ACTIVE },
    });
    if (activeCount > 0) {
      throw new BadRequestException('Cannot delete a batch with active students enrolled');
    }

    await this.batchRepo.softDelete(id);
    return { message: 'Batch deleted successfully' };
  }

  async enrollStudent(batchId: string, dto: EnrollStudentDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const student = await this.getStudentById(dto.studentId, tenantId);
    await this.assertBatchCapacity(batch.id, batch.maxStudents, tenantId);

    const existing = await this.enrollmentRepo.findOne({
      where: { tenantId, batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    if (existing) {
      throw new BadRequestException('Student is already actively enrolled in this batch');
    }

    const enrollment = await this.enrollmentRepo.save(
      this.enrollmentRepo.create({
        tenantId,
        batchId,
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
        feePaid: dto.feePaid ?? null,
        feePaidAt: dto.feePaid ? new Date() : null,
      }),
    );

    return enrollment;
  }

  async bulkEnrollStudents(batchId: string, dto: BulkEnrollDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const details = [];
    let enrolled = 0;
    let skipped = 0;
    let failed = 0;

    for (const studentId of dto.studentIds) {
      try {
        await this.assertBatchCapacity(batch.id, batch.maxStudents, tenantId);
        const student = await this.getStudentById(studentId, tenantId);
        const existing = await this.enrollmentRepo.findOne({
          where: { tenantId, batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
        });
        if (existing) {
          skipped++;
          details.push({ studentId, status: 'skipped', reason: 'already enrolled' });
          continue;
        }

        await this.enrollmentRepo.save(
          this.enrollmentRepo.create({
            tenantId,
            batchId,
            studentId: student.id,
            status: EnrollmentStatus.ACTIVE,
          }),
        );
        enrolled++;
        details.push({ studentId, status: 'enrolled' });
      } catch (error) {
        failed++;
        details.push({ studentId, status: 'failed', reason: error.message });
      }
    }

    return { enrolled, skipped, failed, details };
  }

  async removeStudent(batchId: string, studentId: string, tenantId: string) {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { tenantId, batchId, studentId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) throw new NotFoundException('Active enrollment not found');

    enrollment.status = EnrollmentStatus.COMPLETED;
    await this.enrollmentRepo.save(enrollment);

    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const student = await this.studentRepo.findOne({ where: { id: studentId, tenantId } });
    if (student) {
      await this.notificationService.send({
        userId: student.userId,
        tenantId,
        title: `You have been removed from batch ${batch.name}`,
        body: `You have been removed from batch ${batch.name}`,
        channels: ['push', 'in_app'],
        refType: 'batch_removed',
        refId: batch.id,
      });
    }

    return { message: 'Student removed from batch' };
  }

  async getRoster(batchId: string, query: RosterQueryDto, user: any, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdmin(batch, user);

    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [enrollments, total] = await this.enrollmentRepo.findAndCount({
      where: { tenantId, batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student', 'student.user'],
      skip,
      take: limit,
      order: { enrolledAt: 'ASC' },
    });

    const studentIds = enrollments.map((enrollment) => enrollment.studentId);
    const lastTestScores = await this.getLastTestScoresForBatch(batchId, studentIds, tenantId);
    const watchedThisWeek = await this.getLecturesWatchedThisWeek(batchId, studentIds, tenantId);

    return {
      data: enrollments.map((enrollment) => ({
        studentId: enrollment.studentId,
        name: enrollment.student?.user?.fullName || null,
        phone: enrollment.student?.user?.phoneNumber || null,
        lastLoginAt: enrollment.student?.user?.lastLoginAt || null,
        streakDays: enrollment.student?.currentStreak || 0,
        lastTestScore: lastTestScores.get(enrollment.studentId) ?? null,
        lecturesWatchedThisWeek: watchedThisWeek.get(enrollment.studentId) ?? 0,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async getLiveAttendance(batchId: string, user: any, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdmin(batch, user);

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student', 'student.user'],
    });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const activeThreshold = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

    // Fetch today's lecture progress for this batch
    const lectures = await this.lectureRepo.find({ where: { tenantId, batchId } });
    const lectureIds = lectures.map((l) => l.id);
    const studentIds = enrollments.map((e) => e.studentId);

    const todayLectureProgress = lectureIds.length && studentIds.length
      ? await this.lectureProgressRepo
          .createQueryBuilder('lp')
          .where('lp.tenantId = :tenantId', { tenantId })
          .andWhere('lp.lectureId IN (:...lectureIds)', { lectureIds })
          .andWhere('lp.studentId IN (:...studentIds)', { studentIds })
          .andWhere('lp.updatedAt >= :startOfDay', { startOfDay: new Date(todayStr + 'T00:00:00.000Z') })
          .andWhere('lp.watchPercentage > 0')
          .getMany()
      : [];

    // Fetch today's test sessions
    const todayTestSessions = studentIds.length
      ? await this.sessionRepo
          .createQueryBuilder('ts')
          .where('ts.tenantId = :tenantId', { tenantId })
          .andWhere('ts.studentId IN (:...studentIds)', { studentIds })
          .andWhere('ts.createdAt >= :startOfDay', { startOfDay: new Date(todayStr + 'T00:00:00.000Z') })
          .getMany()
      : [];

    // Map activities per student
    const lecturesByStudent = new Map<string, number>();
    for (const lp of todayLectureProgress) {
      lecturesByStudent.set(lp.studentId, (lecturesByStudent.get(lp.studentId) ?? 0) + 1);
    }
    const testsByStudent = new Map<string, number>();
    for (const ts of todayTestSessions) {
      testsByStudent.set(ts.studentId, (testsByStudent.get(ts.studentId) ?? 0) + 1);
    }

    const students = enrollments.map((e) => {
      const u = e.student?.user;
      const lastLogin = u?.lastLoginAt ? new Date(u.lastLoginAt) : null;
      const isActiveNow = lastLogin ? lastLogin >= activeThreshold : false;
      const studiedToday = e.student?.lastActiveDate === todayStr;
      const lecturesWatched = lecturesByStudent.get(e.studentId) ?? 0;
      const testsGiven = testsByStudent.get(e.studentId) ?? 0;

      // Determine what the student is doing
      let currentActivity: string | null = null;
      if (isActiveNow) {
        if (lecturesWatched > 0) currentActivity = 'Watching lectures';
        else if (testsGiven > 0) currentActivity = 'Taking quiz';
        else currentActivity = 'Browsing';
      }

      return {
        studentId: e.studentId,
        name: u?.fullName ?? null,
        isActiveNow,
        studiedToday,
        lastLoginAt: u?.lastLoginAt ?? null,
        lastActiveDate: e.student?.lastActiveDate ?? null,
        lecturesWatchedToday: lecturesWatched,
        testsGivenToday: testsGiven,
        streakDays: e.student?.currentStreak ?? 0,
        currentActivity,
      };
    });

    const activeNowCount = students.filter((s) => s.isActiveNow).length;
    const studiedTodayCount = students.filter((s) => s.studiedToday).length;
    const totalStudents = students.length;

    return {
      totalStudents,
      activeNowCount,
      studiedTodayCount,
      asOf: now.toISOString(),
      students: students.sort((a, b) => {
        // Active now first, then studied today, then rest
        if (a.isActiveNow !== b.isActiveNow) return a.isActiveNow ? -1 : 1;
        if (a.studiedToday !== b.studiedToday) return a.studiedToday ? -1 : 1;
        return (a.name ?? '').localeCompare(b.name ?? '');
      }),
    };
  }

  async getAttendance(batchId: string, query: AttendanceQueryDto, user: any, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdmin(batch, user);

    const enrollments = await this.enrollmentRepo.find({
      where: {
        tenantId,
        batchId,
        status: EnrollmentStatus.ACTIVE,
        ...(query.studentId ? { studentId: query.studentId } : {}),
      },
      relations: ['student', 'student.user'],
    });

    const lectures = await this.lectureRepo.find({ where: { tenantId, batchId } });
    const lectureIds = lectures.map((lecture) => lecture.id);
    const progress = lectureIds.length
      ? await this.lectureProgressRepo.find({
          where: { tenantId, lectureId: In(lectureIds) },
        })
      : [];

    const days = this.expandDates(query.startDate, query.endDate);
    return enrollments.map((enrollment) => {
      const studentProgress = progress.filter((item) => item.studentId === enrollment.studentId && item.watchPercentage > 0);
      const watchedDates = new Set(
        studentProgress
          .map((item) => lectures.find((lecture) => lecture.id === item.lectureId))
          .filter(Boolean)
          .map((lecture) => this.toDateOnly(lecture.scheduledAt || lecture.createdAt)),
      );

      return {
        studentId: enrollment.studentId,
        name: enrollment.student?.user?.fullName || null,
        days: days.map((date) => ({ date, watched: watchedDates.has(date) })),
      };
    });
  }

  async getBatchPerformance(batchId: string, user: any, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdmin(batch, user);

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student', 'student.user'],
    });
    const studentIds = enrollments.map((enrollment) => enrollment.studentId);
    const sessions = await this.getSessionsForBatch(batchId, studentIds, tenantId);

    const avgAccuracy = sessions.length
      ? sessions.reduce((sum, session) => {
          const attempts = (session.correctCount || 0) + (session.wrongCount || 0);
          return sum + (attempts ? ((session.correctCount || 0) / attempts) * 100 : 0);
        }, 0) / sessions.length
      : 0;
    const avgScore = sessions.length
      ? sessions.reduce((sum, session) => sum + Number(session.totalScore || 0), 0) / sessions.length
      : 0;

    const byStudent = enrollments.map((enrollment) => {
      const studentSessions = sessions.filter((session) => session.studentId === enrollment.studentId);
      const score = studentSessions.length
        ? studentSessions.reduce((sum, session) => sum + Number(session.totalScore || 0), 0) / studentSessions.length
        : 0;
      return {
        studentId: enrollment.studentId,
        name: enrollment.student?.user?.fullName || null,
        score: Number(score.toFixed(2)),
      };
    }).sort((a, b) => b.score - a.score);

    return {
      avgAccuracy: Number(avgAccuracy.toFixed(2)),
      avgScore: Number(avgScore.toFixed(2)),
      topStudents: byStudent.slice(0, 5),
      bottomStudents: [...byStudent].reverse().slice(0, 5),
      testCount: sessions.length,
    };
  }

  // ── Student Detail (teacher view) ────────────────────────────────────────

  async getStudentDetail(batchId: string, studentId: string, user: any, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdminBatchAccess(batch, user, tenantId);

    // Verify the student is actually enrolled in this batch
    const enrollment = await this.enrollmentRepo.findOne({
      where: { tenantId, batchId, studentId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) throw new NotFoundException('Student not found in this batch');

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenantId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student not found');

    // Fetch in parallel for performance
    const [engagementLogs, weakTopics, batchLectures, recentSessions] = await Promise.all([
      this.engagementLogRepo.find({
        where: { studentId },
        order: { loggedAt: 'DESC' },
        take: 5,
      }),
      this.weakTopicRepo.find({
        where: { studentId },
        order: { severity: 'DESC' },
        take: 10,
      }),
      this.lectureRepo.find({
        where: { tenantId, batchId },
        order: { scheduledAt: 'ASC' },
      }),
      this.getRecentTestSessions(studentId, tenantId, 10),
    ]);

    // Enrich weak topics with topic name
    const topicIds = [...new Set(weakTopics.map(w => w.topicId))];
    const topics = topicIds.length
      ? await this.topicRepo.find({ where: { id: In(topicIds) } })
      : [];
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    // Map lecture progress for this student
    const lectureIds = batchLectures.map(l => l.id);
    const lectureProgress = lectureIds.length
      ? await this.lectureProgressRepo.find({
          where: { tenantId, studentId, lectureId: In(lectureIds) },
        })
      : [];
    const progressMap = new Map(lectureProgress.map(p => [p.lectureId, p]));

    // Compute attendance summary
    const totalLectures = batchLectures.length;
    const watchedLectures = lectureProgress.filter(p => p.watchPercentage >= 80).length;
    const attendancePct = totalLectures > 0 ? Math.round((watchedLectures / totalLectures) * 100) : 0;

    // Determine AI engagement level (from latest log)
    const latestEngagement = engagementLogs[0]?.state ?? null;

    return {
      profile: {
        studentId: student.id,
        userId: student.userId,
        name: student.user?.fullName ?? null,
        phone: student.user?.phoneNumber ?? null,
        email: student.user?.email ?? null,
        class: student.class,
        examTarget: student.examTarget,
        examYear: student.examYear,
        targetCollege: student.targetCollege ?? null,
        streakDays: student.currentStreak,
        longestStreak: student.longestStreak,
        xpTotal: student.xpTotal,
        lastActiveDate: student.lastActiveDate ?? null,
        lastLoginAt: student.user?.lastLoginAt ?? null,
        subscriptionPlan: student.subscriptionPlan,
        enrolledAt: enrollment.enrolledAt,
        aiEngagementState: latestEngagement,
      },
      attendance: {
        totalLectures,
        watchedLectures,
        attendancePct,
      },
      engagementLogs: engagementLogs.map(log => ({
        state: log.state,
        context: log.context,
        contextRefId: log.contextRefId,
        confidence: log.confidence,
        loggedAt: log.loggedAt,
      })),
      weakTopics: weakTopics.map(w => ({
        topicId: w.topicId,
        topicName: topicMap.get(w.topicId) ?? 'Unknown Topic',
        severity: w.severity,
        accuracy: w.accuracy,
        wrongCount: w.wrongCount,
        lastAttemptedAt: w.lastAttemptedAt,
      })),
      lectures: batchLectures.map(lecture => {
        const progress = progressMap.get(lecture.id);
        const quizResponses = (progress?.quizResponses ?? []) as Array<{ isCorrect: boolean }>;
        const quizTotal = quizResponses.length;
        const quizCorrect = quizResponses.filter(r => r.isCorrect).length;
        return {
          lectureId: lecture.id,
          title: lecture.title,
          scheduledAt: lecture.scheduledAt,
          watchPercentage: progress?.watchPercentage ?? 0,
          isCompleted: progress?.isCompleted ?? false,
          rewindCount: progress?.rewindCount ?? 0,
          quizScore: quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : null,
          quizTotal,
          quizCorrect,
        };
      }),
      testScores: recentSessions.map(session => ({
        sessionId: session.id,
        totalScore: Number(session.totalScore ?? 0),
        correctCount: session.correctCount ?? 0,
        wrongCount: session.wrongCount ?? 0,
        submittedAt: session.submittedAt ?? session.updatedAt,
      })),
    };
  }

  // ── Flag a Student ────────────────────────────────────────────────────────

  async flagStudent(
    batchId: string,
    studentId: string,
    dto: FlagStudentDto,
    teacherUserId: string,
    tenantId: string,
  ) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdminBatchAccess(batch, { id: teacherUserId, role: UserRole.TEACHER }, tenantId);

    const enrollment = await this.enrollmentRepo.findOne({
      where: { tenantId, batchId, studentId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollment) throw new NotFoundException('Student not found in this batch');

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenantId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student not found');

    const reasonLabel: Record<FlagReason, string> = {
      [FlagReason.MISSED_CLASSES]: 'missing classes',
      [FlagReason.SCORE_DROP]: 'a drop in test scores',
      [FlagReason.NOT_ENGAGING]: 'low engagement',
    };

    const reason = reasonLabel[dto.reason];
    const noteText = dto.note ? ` Note from teacher: "${dto.note}"` : '';

    // 1. Notify student (in-app + push gentle nudge)
    await this.notificationService.send({
      userId: student.userId,
      tenantId,
      title: "Your teacher wants to help",
      body: `Your teacher has noticed you may need support due to ${reason}. Keep going — reach out if you need help!${noteText}`,
      channels: ['in_app', 'push'],
      refType: 'teacher_flagged',
      refId: batch.id,
    });

    // 2. Notify parent via WhatsApp (fire-and-forget, non-blocking)
    if (student.parentUserId) {
      this.notificationService.send({
        userId: student.parentUserId,
        tenantId,
        title: "Student Progress Alert",
        body: `Your child ${student.user?.fullName ?? 'your ward'} has been flagged by their teacher at ${batch.name} due to ${reason}. Please encourage them to stay consistent.${noteText}`,
        channels: ['whatsapp', 'in_app'],
        refType: 'teacher_flagged',
        refId: batch.id,
      }).catch(err => this.logger.warn(`Parent notification failed for student ${studentId}: ${err.message}`));
    }

    // 3. Notify all admins of this tenant (in-app)
    const admins = await this.userRepo.find({
      where: { tenantId, role: UserRole.INSTITUTE_ADMIN, status: UserStatus.ACTIVE },
    });
    for (const admin of admins) {
      this.notificationService.send({
        userId: admin.id,
        tenantId,
        title: "Student Flagged",
        body: `${student.user?.fullName ?? 'A student'} in batch "${batch.name}" was flagged for ${reason}.${noteText}`,
        channels: ['in_app'],
        refType: 'teacher_flagged',
        refId: studentId,
      }).catch(err => this.logger.warn(`Admin notification failed: ${err.message}`));
    }

    return {
      flagged: true,
      studentName: student.user?.fullName ?? null,
      reason: dto.reason,
      parentNotified: !!student.parentUserId,
      adminsNotified: admins.length,
    };
  }

  // ── Inactive Students ─────────────────────────────────────────────────────

  async getInactiveStudents(batchId: string, user: any, tenantId: string, inactiveDays = 3) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertTeacherOrAdminBatchAccess(batch, user, tenantId);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - inactiveDays);

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student', 'student.user'],
    });

    const inactive = enrollments
      .filter(e => {
        const lastLogin = e.student?.user?.lastLoginAt;
        if (!lastLogin) return true; // never logged in
        return new Date(lastLogin) < cutoff;
      })
      .map(e => {
        const lastLogin = e.student?.user?.lastLoginAt;
        const daysInactive = lastLogin
          ? Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86_400_000)
          : null;
        return {
          studentId: e.studentId,
          userId: e.student?.userId,
          name: e.student?.user?.fullName ?? null,
          phone: e.student?.user?.phoneNumber ?? null,
          lastLoginAt: lastLogin ?? null,
          daysInactive,
          streakDays: e.student?.currentStreak ?? 0,
        };
      })
      .sort((a, b) => (b.daysInactive ?? 999) - (a.daysInactive ?? 999));

    return { total: inactive.length, cutoffDays: inactiveDays, students: inactive };
  }

  async sendBulkReminder(batchId: string, user: any, tenantId: string) {
    const { students } = await this.getInactiveStudents(batchId, user, tenantId);

    let sent = 0;
    for (const s of students) {
      if (!s.userId) continue;
      await this.notificationService.send({
        userId: s.userId,
        tenantId,
        title: "We miss you! 👋",
        body: "You haven't logged in for a few days. Your study plan is waiting — let's get back on track!",
        channels: ['in_app', 'push'],
        refType: 'inactive_reminder',
        refId: batchId,
      });
      sent++;
    }

    return { sent, message: `Reminder sent to ${sent} inactive student(s)` };
  }

  async generateInviteLink(batchId: string, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const token = randomUUID();
    await this.cacheManager.set(`batch-invite:${token}`, { batchId: batch.id, tenantId }, 7 * 24 * 60 * 60 * 1000);
    return {
      inviteUrl: `https://${tenantId}.apexiq.in/join?token=${token}`,
    };
  }

  async joinBatchByToken(token: string, userId: string, tenantId: string) {
    const payload = await this.cacheManager.get<{ batchId: string; tenantId: string }>(`batch-invite:${token}`);
    if (!payload || payload.tenantId !== tenantId) {
      throw new BadRequestException('Invalid or expired invite token');
    }

    const student = await this.getStudentByUserId(userId, tenantId);
    await this.enrollStudent(payload.batchId, { studentId: student.id }, tenantId);
    await this.cacheManager.del(`batch-invite:${token}`);
    return { message: 'Joined batch successfully' };
  }

  // ── Subject-Teacher Assignment ────────────────────────────────────────────

  async getSubjectTeachers(batchId: string, tenantId: string) {
    await this.getBatchOrThrow(batchId, tenantId);
    const rows = await this.batchSubjectTeacherRepo.find({
      where: { batchId, tenantId },
      relations: ['teacher'],
      order: { subjectName: 'ASC' },
    });
    return rows.map(r => ({
      id: r.id,
      subjectName: r.subjectName,
      teacherId: r.teacherId,
      teacherName: r.teacher?.fullName || null,
      teacherEmail: r.teacher?.email || null,
      teacherStatus: r.teacher?.status || null,
    }));
  }

  async assignSubjectTeacher(batchId: string, dto: AssignSubjectTeacherDto, tenantId: string) {
    await this.getBatchOrThrow(batchId, tenantId);
    await this.validateTeacher(dto.teacherId, tenantId);

    const existing = await this.batchSubjectTeacherRepo.findOne({
      where: { batchId, subjectName: dto.subjectName, tenantId },
    });

    if (existing) {
      existing.teacherId = dto.teacherId;
      return this.batchSubjectTeacherRepo.save(existing);
    }

    const assignment = this.batchSubjectTeacherRepo.create({
      batchId,
      teacherId: dto.teacherId,
      subjectName: dto.subjectName,
      tenantId,
    });
    return this.batchSubjectTeacherRepo.save(assignment);
  }

  async removeSubjectTeacher(batchId: string, assignmentId: string, tenantId: string) {
    const row = await this.batchSubjectTeacherRepo.findOne({
      where: { id: assignmentId, batchId, tenantId },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.batchSubjectTeacherRepo.remove(row);
    return { message: 'Subject teacher removed' };
  }

  async createAndEnrollStudent(batchId: string, dto: CreateBatchStudentDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    await this.assertBatchCapacity(batch.id, batch.maxStudents, tenantId);

    // Duplicate checks
    const existingPhone = await this.userRepo.findOne({ where: { phoneNumber: dto.phoneNumber, tenantId } });
    if (existingPhone) throw new ConflictException('A user with this phone number already exists in this tenant');

    const existingEmail = await this.userRepo.findOne({ where: { email: dto.email, tenantId } });
    if (existingEmail) throw new ConflictException('A user with this email already exists in this tenant');

    const tempPassword = this.generateTempPassword();

    const user = this.userRepo.create({
      phoneNumber: dto.phoneNumber,
      fullName: dto.fullName,
      email: dto.email,
      password: tempPassword,
      tenantId,
      role: UserRole.STUDENT,
      status: UserStatus.PENDING_VERIFICATION,
      isFirstLogin: true,
      phoneVerified: true,
    });
    await this.userRepo.save(user);

    const student = this.studentRepo.create({
      userId: user.id,
      tenantId,
      examTarget: ExamTarget.BOTH,
      class: StudentClass.CLASS_11,
      examYear: ExamYear.Y2026,
      subscriptionPlan: SubscriptionPlan.INSTITUTE,
    });
    await this.studentRepo.save(student);

    await this.enrollmentRepo.save(
      this.enrollmentRepo.create({ tenantId, batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE }),
    );

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const instituteName = tenant?.name || 'EDVA';
    this.mailService.sendCredentials(dto.email, dto.fullName, dto.email, tempPassword, instituteName)
      .catch(err => this.logger.error(`Failed sending student credentials: ${err.message}`));

    return { student: { ...user, tempPassword }, tempPassword, message: 'Student created and enrolled.' };
  }

  async bulkCreateAndEnrollStudents(batchId: string, dto: BulkCreateBatchStudentsDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const instituteName = tenant?.name || 'EDVA';

    const results: { fullName: string; email: string; tempPassword: string; status: string; error?: string }[] = [];

    for (const s of dto.students) {
      try {
        await this.assertBatchCapacity(batch.id, batch.maxStudents, tenantId);

        const existingPhone = await this.userRepo.findOne({ where: { phoneNumber: s.phoneNumber, tenantId } });
        if (existingPhone) {
          results.push({ fullName: s.fullName, email: s.email, tempPassword: '', status: 'skipped', error: 'Phone number already exists' });
          continue;
        }

        const existingEmail = await this.userRepo.findOne({ where: { email: s.email, tenantId } });
        if (existingEmail) {
          results.push({ fullName: s.fullName, email: s.email, tempPassword: '', status: 'skipped', error: 'Email already exists' });
          continue;
        }

        const tempPassword = this.generateTempPassword();

        const user = this.userRepo.create({
          phoneNumber: s.phoneNumber,
          fullName: s.fullName,
          email: s.email,
          password: tempPassword,
          tenantId,
          role: UserRole.STUDENT,
          status: UserStatus.PENDING_VERIFICATION,
          isFirstLogin: true,
          phoneVerified: true,
        });
        await this.userRepo.save(user);

        const student = this.studentRepo.create({
          userId: user.id,
          tenantId,
          examTarget: ExamTarget.BOTH,
          class: StudentClass.CLASS_11,
          examYear: ExamYear.Y2026,
          subscriptionPlan: SubscriptionPlan.INSTITUTE,
        });
        await this.studentRepo.save(student);

        await this.enrollmentRepo.save(
          this.enrollmentRepo.create({ tenantId, batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE }),
        );

        this.mailService.sendCredentials(s.email, s.fullName, s.email, tempPassword, instituteName)
          .catch(err => this.logger.error(`Bulk student email fail ${s.email}: ${err.message}`));

        results.push({ fullName: s.fullName, email: s.email, tempPassword, status: 'created' });
      } catch (err) {
        results.push({ fullName: s.fullName, email: s.email, tempPassword: '', status: 'failed', error: err.message });
      }
    }

    const created = results.filter(r => r.status === 'created').length;
    const skipped = results.filter(r => r.status !== 'created').length;
    return { results, summary: { total: dto.students.length, created, skipped }, message: `${created} students enrolled.` };
  }

  private generateTempPassword(): string {
    return randomBytes(5).toString('hex').toUpperCase() + '@1';
  }

  private async validateTeacher(teacherId: string, tenantId: string) {
    const teacher = await this.userRepo.findOne({
      where: { id: teacherId, tenantId, role: UserRole.TEACHER },
    });
    if (!teacher) throw new BadRequestException('teacherId must reference a teacher in this tenant');
    return teacher;
  }

  private async getBatchOrThrow(id: string, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id, tenantId }, relations: ['teacher'] });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);
    return batch;
  }

  private async getStudentById(studentId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { id: studentId, tenantId } });
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);
    return student;
  }

  private async getStudentByUserId(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async assertBatchAccess(batch: Batch, user: any, tenantId: string) {
    if (user.role === UserRole.TEACHER && batch.teacherId !== user.id) {
      throw new ForbiddenException('You can only access your own batches');
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      const enrollment = await this.enrollmentRepo.findOne({
        where: { tenantId, batchId: batch.id, studentId: student.id, status: EnrollmentStatus.ACTIVE },
      });
      if (!enrollment) throw new ForbiddenException('You are not enrolled in this batch');
    }
  }

  private async assertTeacherOrAdmin(batch: Batch, user: any) {
    if (user.role === UserRole.TEACHER && batch.teacherId !== user.id) {
      throw new ForbiddenException('You can only access your own batches');
    }
  }

  private async assertBatchCapacity(batchId: string, maxStudents: number, tenantId: string) {
    const count = await this.enrollmentRepo.count({
      where: { tenantId, batchId, status: EnrollmentStatus.ACTIVE },
    });
    if (count >= maxStudents) {
      throw new BadRequestException('Batch has reached capacity');
    }
  }

  private expandDates(startDate: string, endDate: string) {
    const dates: string[] = [];
    let cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    while (cursor <= end) {
      dates.push(this.toDateOnly(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  private toDateOnly(date: Date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  private async getLecturesWatchedThisWeek(batchId: string, studentIds: string[], tenantId: string) {
    if (!studentIds.length) return new Map<string, number>();

    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const lectures = await this.lectureRepo.find({ where: { tenantId, batchId } });
    const lectureIds = lectures.map((lecture) => lecture.id);
    if (!lectureIds.length) return new Map<string, number>();

    const progress = await this.lectureProgressRepo.find({
      where: { tenantId, lectureId: In(lectureIds), studentId: In(studentIds) },
    });

    const result = new Map<string, number>();
    for (const item of progress) {
      const lecture = lectures.find((entry) => entry.id === item.lectureId);
      if (!lecture) continue;
      const lectureDate = lecture.scheduledAt || lecture.createdAt;
      if (lectureDate < weekStart || item.watchPercentage <= 0) continue;
      result.set(item.studentId, (result.get(item.studentId) || 0) + 1);
    }
    return result;
  }

  private async getLastTestScoresForBatch(batchId: string, studentIds: string[], tenantId: string) {
    const sessions = await this.getSessionsForBatch(batchId, studentIds, tenantId);
    const latest = new Map<string, { submittedAt: Date; totalScore: number }>();
    for (const session of sessions) {
      const submittedAt = session.submittedAt || session.updatedAt;
      const current = latest.get(session.studentId);
      if (!current || new Date(submittedAt) > new Date(current.submittedAt)) {
        latest.set(session.studentId, { submittedAt, totalScore: Number(session.totalScore || 0) });
      }
    }
    return new Map(Array.from(latest.entries()).map(([studentId, value]) => [studentId, value.totalScore]));
  }

  private async getSessionsForBatch(batchId: string, studentIds: string[], tenantId: string) {
    if (!studentIds.length) return [];
    const schema = await this.getMockTestBatchSchema();
    const baseSessions = await this.sessionRepo.find({
      where: [
        { tenantId, studentId: In(studentIds), status: TestSessionStatus.SUBMITTED },
        { tenantId, studentId: In(studentIds), status: TestSessionStatus.AUTO_SUBMITTED },
      ],
    });

    if (!schema.batchId || !baseSessions.length) {
      return baseSessions;
    }

    const mockTestIds = [...new Set(baseSessions.map((session) => session.mockTestId))];
    const rows = await (this.sessionRepo.manager.connection as any).query(
      `
        SELECT id, batch_id AS "batchId"
        FROM mock_tests
        WHERE id = ANY($1)
      `,
      [mockTestIds],
    );
    const allowed = new Set(rows.filter((row) => row.batchId === batchId).map((row) => row.id));
    return baseSessions.filter((session) => allowed.has(session.mockTestId));
  }

  /**
   * Allows teacher access if they are the primary teacher OR a subject-teacher
   * assigned to any subject in this batch. Admins always pass.
   */
  private async assertTeacherOrAdminBatchAccess(batch: Batch, user: any, tenantId: string) {
    if (
      user.role === UserRole.INSTITUTE_ADMIN ||
      user.role === UserRole.SUPER_ADMIN
    ) return;

    if (user.role === UserRole.TEACHER) {
      if (batch.teacherId === user.id) return;

      // Check subject-teacher assignment
      const subjectAssignment = await this.batchSubjectTeacherRepo.findOne({
        where: { batchId: batch.id, teacherId: user.id, tenantId },
      });
      if (subjectAssignment) return;

      throw new ForbiddenException('You do not have access to this batch');
    }

    throw new ForbiddenException('Insufficient permissions');
  }

  private async getRecentTestSessions(studentId: string, tenantId: string, limit: number) {
    return this.sessionRepo.find({
      where: [
        { tenantId, studentId, status: TestSessionStatus.SUBMITTED },
        { tenantId, studentId, status: TestSessionStatus.AUTO_SUBMITTED },
      ],
      order: { submittedAt: 'DESC' },
      take: limit,
    });
  }

  private async getMockTestBatchSchema(): Promise<MockTestBatchSchema> {
    if (!this.mockTestBatchSchemaPromise) {
      this.mockTestBatchSchemaPromise = (this.sessionRepo.manager.connection as any)
        .query(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'mock_tests'
          `,
        )
        .then((rows: Array<{ column_name: string }>) => ({
          batchId: rows.some((row) => row.column_name === 'batch_id'),
        }))
        .catch(() => ({ batchId: false }));
    }
    return this.mockTestBatchSchemaPromise;
  }
}
