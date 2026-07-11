import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, MoreThan } from 'typeorm';

import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { PlatformConfig, PaymentTransaction, PaymentStatus } from '../../database/entities/payment.entity';
import { Batch, BatchStatus, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { BatchFeedback } from '../../database/entities/batch-feedback.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';
import { Doubt, DoubtStatus, Lecture, LectureProgress } from '../../database/entities/learning.entity';
import { Student, ExamTarget, StudentClass, ExamYear, SubscriptionPlan } from '../../database/entities/student.entity';
import { Tenant } from '../../database/entities/tenant.entity';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { EngagementLog, WeakTopic } from '../../database/entities/analytics.entity';
import { Chapter, Subject, Topic, TopicResource } from '../../database/entities/subject.entity';

import {
  AttendanceQueryDto,
  BatchListQueryDto,
  CreateBatchDto,
  FlagReason,
  FlagStudentDto,
  RosterQueryDto,
  UpdateBatchDto,
  SubmitFeedbackDto,
} from './dto/batch.dto';
import { toJsonSafeDeep } from '../../common/utils/json-safe';
import { AssignSubjectTeacherDto, BulkEnrollDto, BulkCreateBatchStudentsDto, CreateBatchStudentDto, EnrollStudentDto } from './dto/enrollment.dto';

import Razorpay from 'razorpay';

type MockTestBatchSchema = { batchId: boolean };

@Injectable()
export class BatchService {
  private mockTestBatchSchemaPromise: Promise<MockTestBatchSchema> | null = null;
  private readonly logger = new Logger(BatchService.name);
  private static readonly presetExamTargets = new Set(['jee', 'neet', 'both']);
  private static readonly presetClasses = new Set(['9', '10', '11', '12', 'dropper']);

  constructor(
    @InjectRepository(Batch, 'coaching')
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(User, 'coaching')
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant, 'coaching')
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(BatchSubjectTeacher, 'coaching')
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(BatchFeedback, 'coaching')
    private readonly batchFeedbackRepo: Repository<BatchFeedback>,
    @InjectRepository(LectureProgress, 'coaching')
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(Lecture, 'coaching')
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(TestSession, 'coaching')
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(Doubt, 'coaching')
    private readonly doubtRepo: Repository<Doubt>,
    @InjectRepository(WeakTopic, 'coaching')
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(EngagementLog, 'coaching')
    private readonly engagementLogRepo: Repository<EngagementLog>,
    @InjectRepository(Topic, 'coaching')
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Subject, 'coaching')
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter, 'coaching')
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(TopicResource, 'coaching')
    private readonly topicResourceRepo: Repository<TopicResource>,
    @InjectRepository(PlatformConfig, 'coaching')
    private readonly platformConfigRepo: Repository<PlatformConfig>,
    @InjectRepository(PaymentTransaction, 'coaching')
    private readonly paymentTxRepo: Repository<PaymentTransaction>,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** Returns current platform config, creating a default row if none exists. */
  async getPlatformConfig(): Promise<PlatformConfig> {
    let cfg = await this.platformConfigRepo.findOne({ where: { isSingleton: true } });
    if (!cfg) {
      cfg = await this.platformConfigRepo.save(this.platformConfigRepo.create({ commissionPercent: 5, isSingleton: true }));
    }
    return cfg;
  }

  private normalizeBatchExamTarget(value: string) {
    const cleaned = value.trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      throw new BadRequestException('Exam target is required.');
    }

    const lowered = cleaned.toLowerCase();
    return BatchService.presetExamTargets.has(lowered) ? lowered : cleaned;
  }

  private normalizeBatchClass(value: string) {
    const cleaned = value.trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      throw new BadRequestException('Class level is required.');
    }

    const lowered = cleaned.toLowerCase();
    return BatchService.presetClasses.has(lowered) ? lowered : cleaned;
  }

  async createBatch(dto: CreateBatchDto, tenantId: string) {
    if (dto.teacherId) {
      await this.validateTeacher(dto.teacherId, tenantId);
    }

    const isPaid = dto.isPaid ?? false;
    if (isPaid && (!dto.feeAmount || dto.feeAmount <= 0)) {
      throw new BadRequestException('Fee amount is required and must be greater than 0 for paid batches.');
    }

    const batch = this.batchRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      examTarget: this.normalizeBatchExamTarget(dto.examTarget),
      class: this.normalizeBatchClass(dto.class),
      teacherId: dto.teacherId ?? null,
      isPaid,
      feeAmount: isPaid ? dto.feeAmount : null,
      platformFeePercent: Number((await this.getPlatformConfig()).commissionPercent),
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      status: BatchStatus.ACTIVE,
    });

    const saved = await this.batchRepo.save(batch);
    await this.bustBatchesCache(tenantId);
    return saved;
  }

  private async bustBatchesCache(tenantId: string) {
    const gen = await this.cacheManager.get<number>(`coaching:batches-gen:${tenantId}`) ?? 0;
    await this.cacheManager.set(`coaching:batches-gen:${tenantId}`, gen + 1, 60 * 60 * 1000);
  }

  async getBatches(query: BatchListQueryDto, user: any, tenantId: string) {
    const gen = await this.cacheManager.get<number>(`coaching:batches-gen:${tenantId}`) ?? 0;
    const cacheKey = `coaching:batches:${tenantId}:${user.id}:${user.role}:${query.status ?? ''}:${query.examTarget ?? ''}:g${gen}`;
    const cachedBatches = await this.cacheManager.get(cacheKey);
    if (cachedBatches) return cachedBatches as any;

    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.teacher', 'teacher')
      .where('batch.tenantId = :tenantId', { tenantId })
      .andWhere('batch.deletedAt IS NULL');

    if (query.status) qb.andWhere('batch.status = :status', { status: query.status });
    if (query.examTarget) {
      qb.andWhere('batch.examTarget = :examTarget', {
        examTarget: this.normalizeBatchExamTarget(query.examTarget),
      });
    }

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

    const batches = await qb.orderBy('batch.createdAt', 'DESC').getMany();

    if (!batches.length) return [];

    const batchIds = batches.map(b => b.id);
    const counts = await this.enrollmentRepo
      .createQueryBuilder('e')
      .select('e.batchId', 'batchId')
      .addSelect('COUNT(*)', 'count')
      .where('e.batchId IN (:...batchIds)', { batchIds })
      .andWhere('e.status = :status', { status: EnrollmentStatus.ACTIVE })
      .andWhere('e.tenantId = :tenantId', { tenantId })
      .groupBy('e.batchId')
      .getRawMany();

    const countMap = new Map<string, number>(counts.map(r => [r.batchId, Number(r.count)]));

    // Single bulk feedback query for all batches — avoids N separate aggregate queries
    const feedbackRows = batchIds.length
      ? await this.batchFeedbackRepo
          .createQueryBuilder('f')
          .select('f.batchId', 'batchId')
          .addSelect('AVG(f.rating)', 'averageRating')
          .addSelect('COUNT(f.id)', 'ratingCount')
          .where('f.batchId IN (:...batchIds)', { batchIds })
          .andWhere('f.tenantId = :tenantId', { tenantId })
          .groupBy('f.batchId')
          .getRawMany()
      : [];
    const feedbackMap = new Map(feedbackRows.map(f => [f.batchId, f]));

    const batchList = batches.map((b) => {
      const n = countMap.get(b.id) ?? 0;
      const bFeedback = feedbackMap.get(b.id);
      return toJsonSafeDeep({
        id: b.id,
        tenantId: b.tenantId,
        name: b.name,
        description: b.description ?? null,
        examTarget: b.examTarget,
        class: b.class,
        teacherId: b.teacherId ?? null,
        teacher: b.teacher ? { id: b.teacher.id, fullName: b.teacher.fullName, email: b.teacher.email ?? null } : undefined,
        teacherName: b.teacher?.fullName ?? undefined,
        maxStudents: b.maxStudents,
        isPaid: b.isPaid,
        feeAmount: b.feeAmount != null ? Number(b.feeAmount) : null,
        platformFeePercent: b.platformFeePercent != null ? Number(b.platformFeePercent) : 20,
        status: b.status,
        startDate: b.startDate ?? null,
        endDate: b.endDate ?? null,
        thumbnailUrl: b.thumbnailUrl ?? null,
        metadata: b.metadata ?? {},
        faqs: Array.isArray(b.faqs) ? b.faqs : [],
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        studentCount: n,
        enrolledCount: n,
        averageRating: bFeedback?.averageRating ? Number(Number(bFeedback.averageRating).toFixed(1)) : 0,
        ratingCount: bFeedback?.ratingCount ? Number(bFeedback.ratingCount) : 0,
      }) as Record<string, unknown>;
    });
    await this.cacheManager.set(cacheKey, batchList, 2 * 60 * 1000);
    return batchList;
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

    // Build curriculum preview with resourceCounts + lectureCount per topic
    const assignments = await this.batchSubjectTeacherRepo.find({ where: { batchId: id } });
    const assignedNames = [...new Set(assignments.map(a => a.subjectName.toLowerCase()))];

    const subjects = await this.subjectRepo.find({
      where: { tenantId, isActive: true },
      relations: ['chapters', 'chapters.topics', 'chapters.topics.resources'],
      order: { sortOrder: 'ASC' },
    });

    const filteredSubjects = subjects.filter(s =>
      assignedNames.includes(s.name.toLowerCase()),
    );

    // Bulk lecture counts per topic for this batch
    const allTopicIds = filteredSubjects.flatMap(s =>
      (s.chapters ?? []).flatMap(c => (c.topics ?? []).map(t => t.id)),
    );

    const lectureCounts: Array<{ topic_id: string; total: string }> = allTopicIds.length
      ? await this.batchRepo.manager.query(`
          SELECT topic_id, COUNT(*)::int AS total
          FROM lectures
          WHERE batch_id = $1
            AND topic_id = ANY($2)
            AND status = 'published'
            AND deleted_at IS NULL
          GROUP BY topic_id
        `, [id, allTopicIds])
      : [];
    const lectureCountMap = new Map(lectureCounts.map(r => [r.topic_id, Number(r.total)]));

    const curriculum = filteredSubjects.map(subject => {
      const teacher = assignments.find(
        a => a.subjectName.toLowerCase() === subject.name.toLowerCase(),
      );
      return {
        id:        subject.id,
        name:      subject.name,
        icon:      subject.icon ?? null,
        colorCode: subject.colorCode ?? null,
        teacherId: teacher?.teacherId ?? null,
        chapters: (subject.chapters ?? [])
          .filter(c => c.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(chapter => ({
            id:   chapter.id,
            name: chapter.name,
            jeeWeightage:  chapter.jeeWeightage,
            neetWeightage: chapter.neetWeightage,
            topics: (chapter.topics ?? [])
              .filter(t => t.isActive)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map(topic => {
                const activeRes = (topic.resources ?? []).filter(r => r.isActive);
                const resourceCounts = activeRes.reduce<Record<string, number>>((acc, r) => {
                  acc[r.type] = (acc[r.type] ?? 0) + 1;
                  return acc;
                }, {});
                return {
                  id:                    topic.id,
                  name:                  topic.name,
                  estimatedStudyMinutes: topic.estimatedStudyMinutes,
                  gatePassPercentage:    topic.gatePassPercentage,
                  lectureCount:          lectureCountMap.get(topic.id) ?? 0,
                  resourceCounts,
                };
              }),
          })),
      };
    });

    const bFeedback = await this.batchFeedbackRepo
      .createQueryBuilder('f')
      .select('AVG(f.rating)', 'averageRating')
      .addSelect('COUNT(f.id)', 'ratingCount')
      .where('f.batchId = :batchId', { batchId: id })
      .andWhere('f.tenantId = :tenantId', { tenantId })
      .getRawOne();

    return {
      ...batch,
      teacherName: batch.teacher?.fullName ?? null,
      studentCount,
      curriculum,
      averageRating: bFeedback?.averageRating ? Number(Number(bFeedback.averageRating).toFixed(1)) : 0,
      ratingCount: bFeedback?.ratingCount ? Number(bFeedback.ratingCount) : 0,
    };
  }

  async submitFeedback(batchId: string, userId: string, dto: SubmitFeedbackDto, requestTenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    
    const enrollment = await this.enrollmentRepo.findOne({
      where: { batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE }
    });

    if (!enrollment) {
      throw new ForbiddenException('You must be enrolled to submit feedback');
    }

    // Upsert feedback
    let feedback = await this.batchFeedbackRepo.findOne({
      where: { batchId, studentId: student.id }
    });
    
    if (feedback) {
      feedback.rating = dto.rating;
      feedback.comment = dto.comment || null;
    } else {
      feedback = this.batchFeedbackRepo.create({
        tenantId: enrollment.tenantId,
        batchId,
        studentId: student.id,
        rating: dto.rating,
        comment: dto.comment || null,
      });
    }

    await this.batchFeedbackRepo.save(feedback);
    return { message: 'Feedback submitted successfully' };
  }

  async getFeedback(batchId: string, tenantId: string) {
    const feedbacks = await this.batchFeedbackRepo.find({
      where: { batchId, tenantId },
      order: { createdAt: 'DESC' }
    });
    
    return feedbacks.map(f => ({
      id: f.id,
      rating: f.rating,
      comment: f.comment,
      createdAt: f.createdAt,
    }));
  }

  async updateBatch(id: string, dto: UpdateBatchDto, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);

    if (dto.teacherId) {
      await this.validateTeacher(dto.teacherId, tenantId);
    }

    // If changing to paid, ensure feeAmount is set
    const becomingPaid = dto.isPaid === true;
    if (becomingPaid && (!dto.feeAmount && !batch.feeAmount)) {
      throw new BadRequestException('Fee amount is required and must be greater than 0 for paid batches.');
    }
    // If switching to free, clear feeAmount
    if (dto.isPaid === false) {
      batch.feeAmount = null;
    }

    const nextExamTarget = dto.examTarget != null
      ? this.normalizeBatchExamTarget(dto.examTarget)
      : batch.examTarget;
    const nextClass = dto.class != null
      ? this.normalizeBatchClass(dto.class)
      : batch.class;

    Object.assign(batch, {
      ...dto,
      examTarget: nextExamTarget,
      class: nextClass,
      feeAmount: dto.isPaid === false ? null : (dto.feeAmount ?? batch.feeAmount),
    });
    const updated = await this.batchRepo.save(batch);
    await this.bustBatchesCache(tenantId);
    return updated;
  }

  async getDashboardStats(tenantId: string) {
    const [
      batches,
      totalTeachers,
      activeTeachers,
      pendingTeachers,
      totalLectures,
      openDoubts,
      recentDoubtsRaw,
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
      // QB count: more reliable than count({ status: In([...]) }) across TypeORM/Postgres enum combos
      this.doubtRepo
        .createQueryBuilder('d')
        .where('d.tenantId = :tenantId', { tenantId })
        .andWhere('d.deletedAt IS NULL')
        .andWhere('d.status IN (:...st)', { st: [DoubtStatus.OPEN, DoubtStatus.ESCALATED] })
        .getCount(),
      this.doubtRepo.find({
        where: { tenantId, status: In([DoubtStatus.OPEN, DoubtStatus.ESCALATED]) },
        relations: ['student', 'student.user', 'topic', 'batch'],
        order: { createdAt: 'DESC' },
        take: 8,
      }),
      this.sessionRepo.count({ where: { tenantId } }),
    ]);

    const recentDoubts = recentDoubtsRaw.map((d) =>
      toJsonSafeDeep({
        id: d.id,
        status: d.status,
        questionText: d.questionText,
        createdAt: d.createdAt,
        batchId: d.batchId,
        batchName: d.batch?.name ?? null,
        topicName: d.topic?.name ?? null,
        studentName: d.student?.user?.fullName ?? null,
      }) as Record<string, unknown>,
    );

    const batchIds = batches.map(b => b.id);
    const totalStudentsRaw = batchIds.length
      ? await this.enrollmentRepo
          .createQueryBuilder('e')
          .innerJoin('e.student', 'student', 'student.deletedAt IS NULL AND student.tenantId = :tenantId', { tenantId })
          .innerJoin('student.user', 'studentUser', 'studentUser.deletedAt IS NULL AND studentUser.tenantId = :tenantId', { tenantId })
          .where('e.tenantId = :tenantId', { tenantId })
          .andWhere('e.batchId IN (:...batchIds)', { batchIds })
          .andWhere('e.status = :status', { status: EnrollmentStatus.ACTIVE })
          .select('COUNT(DISTINCT e.studentId)', 'count')
          .getRawOne()
      : { count: 0 };
    const totalStudents = Number(totalStudentsRaw?.count || 0);

    const activeBatches = batches.filter(b => b.status === BatchStatus.ACTIVE);

    // Recent batches (top 6) with student count — single GROUP BY instead of N COUNT queries
    const recentBatchList = batches.slice(0, 6);
    const recentBatchIds = recentBatchList.map(b => b.id);
    const recentCountRows = recentBatchIds.length
      ? await this.enrollmentRepo
          .createQueryBuilder('e')
          .select('e.batchId', 'batchId')
          .addSelect('COUNT(*)', 'count')
          .where('e.batchId IN (:...ids)', { ids: recentBatchIds })
          .andWhere('e.status = :status', { status: EnrollmentStatus.ACTIVE })
          .groupBy('e.batchId')
          .getRawMany()
      : [];
    const recentCountMap = new Map(recentCountRows.map(r => [r.batchId, Number(r.count)]));
    const recentBatchesWithCount = recentBatchList.map(b => ({
      id: b.id,
      name: b.name,
      examTarget: b.examTarget,
      class: b.class,
      status: b.status,
      teacherName: b.teacher?.fullName || null,
      studentCount: recentCountMap.get(b.id) ?? 0,
      maxStudents: b.maxStudents,
      startDate: b.startDate,
      endDate: b.endDate,
    }));

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
      recentDoubts,
    };
  }

  async deleteBatch(id: string, tenantId: string) {
    const batch = await this.batchRepo.findOne({ where: { id, tenantId } });
    if (!batch) throw new NotFoundException(`Batch ${id} not found`);

    await this.batchRepo.softDelete(id);
    await this.bustBatchesCache(tenantId);
    return { message: 'Batch deleted successfully' };
  }

  async enrollStudent(batchId: string, dto: EnrollStudentDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const student = await this.getStudentById(dto.studentId, tenantId);

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
        fullName: enrollment.student?.user?.fullName || null,
        phone: enrollment.student?.user?.phoneNumber || null,
        phoneNumber: enrollment.student?.user?.phoneNumber || null,
        email: enrollment.student?.user?.email || null,
        enrolledAt: enrollment.enrolledAt || null,
        status: enrollment.status || 'active',
        lastLoginAt: enrollment.student?.user?.lastLoginAt || null,
        streakDays: enrollment.student?.currentStreak || 0,
        lastTestScore: lastTestScores.get(enrollment.studentId) ?? null,
        lecturesWatchedThisWeek: watchedThisWeek.get(enrollment.studentId) ?? 0,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async getInstituteStudents(tenantId: string) {
    return this.enrollmentRepo.query(`
      SELECT
        s.id AS "studentId",
        u.full_name AS name,
        u.full_name AS "fullName",
        u.phone_number AS phone,
        u.phone_number AS "phoneNumber",
        u.email,
        u.phone_verified AS "phoneVerified",
        u.last_login_at AS "lastLoginAt",
        MIN(e.enrolled_at) AS "enrolledAt",
        ARRAY_AGG(DISTINCT b.name ORDER BY b.name) FILTER (WHERE b.name IS NOT NULL) AS "batchNames"
      FROM enrollments e
      JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
      JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
      JOIN batches b ON b.id = e.batch_id AND b.deleted_at IS NULL
      WHERE e.tenant_id = $1
        AND s.tenant_id = $1
        AND u.tenant_id = $1
        AND e.status = 'active'
        AND e.deleted_at IS NULL
      GROUP BY s.id, u.id
      ORDER BY MIN(e.enrolled_at) ASC
    `, [tenantId]);
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
    let batch: Batch | null = null;
    if (batchId !== 'any' && batchId) {
      batch = await this.getBatchOrThrow(batchId, tenantId);
      await this.assertTeacherOrAdminBatchAccess(batch, user, tenantId);
    }

    // Verify the student is actually enrolled in this batch
    let enrollment = (batchId === 'any' || !batchId)
      ? null
      : await this.enrollmentRepo.findOne({
          where: { tenantId, batchId, studentId, status: EnrollmentStatus.ACTIVE },
        });

    if (!enrollment && (batchId === 'any' || !batchId)) {
      enrollment = await this.enrollmentRepo.findOne({
        where: { tenantId, studentId, status: EnrollmentStatus.ACTIVE },
        order: { enrolledAt: 'DESC' },
      });
      if (enrollment) {
        batchId = enrollment.batchId;
      }
    }

    if (!enrollment) throw new NotFoundException('Student not found in this batch');

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenantId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student not found');

    // If batch was found via 'any' enrollment, load it now and check access
    if (!batch && enrollment) {
      batch = await this.batchRepo.findOne({ where: { id: batchId, tenantId }, relations: ['teacher'] });
      if (batch) {
        await this.assertTeacherOrAdminBatchAccess(batch, user, tenantId);
      }
    }

    if (!batch) throw new NotFoundException('Target batch for student not found');

    // Fetch in parallel for performance
    const [engagementLogs, weakTopics, batchLectures, recentSessions, higherXpCount] = await Promise.all([
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
      this.studentRepo.count({
        where: { tenantId: student.tenantId, xpTotal: MoreThan(student.xpTotal || 0) }
      })
    ]);

    const rank = higherXpCount + 1;


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
        level: Math.max(1, Math.floor((student.xpTotal || 0) / 1000) + 1),
        rank: rank,
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

    const sendResults = await Promise.allSettled(
      students
        .filter(s => !!s.userId)
        .map(s => this.notificationService.send({
          userId: s.userId,
          tenantId,
          title: "We miss you! 👋",
          body: "You haven't logged in for a few days. Your study plan is waiting — let's get back on track!",
          channels: ['in_app', 'push'],
          refType: 'inactive_reminder',
          refId: batchId,
        })),
    );
    const sent = sendResults.filter(r => r.status === 'fulfilled').length;

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

  async getBatchPreviewByToken(token: string, tenantId: string) {
    const payload = await this.cacheManager.get<{ batchId: string; tenantId: string }>(`batch-invite:${token}`);
    if (!payload || payload.tenantId !== tenantId) {
      throw new BadRequestException('Invalid or expired invite link');
    }
    const batch = await this.getBatchOrThrow(payload.batchId, tenantId);
    const enrolled = await this.enrollmentRepo.count({ where: { batchId: batch.id, tenantId, status: EnrollmentStatus.ACTIVE } });
    return {
      id: batch.id,
      name: batch.name,
      description: batch.description,
      examTarget: batch.examTarget,
      class: batch.class,
      isPaid: batch.isPaid,
      feeAmount: batch.feeAmount,
      thumbnailUrl: batch.thumbnailUrl,
      maxStudents: batch.maxStudents,
      enrolledCount: enrolled,
      startDate: batch.startDate,
      endDate: batch.endDate,
    };
  }

  async joinBatchByToken(token: string, userId: string, tenantId: string) {
    const payload = await this.cacheManager.get<{ batchId: string; tenantId: string }>(`batch-invite:${token}`);
    if (!payload || payload.tenantId !== tenantId) {
      throw new BadRequestException('Invalid or expired invite token');
    }

    const student = await this.getStudentByUserId(userId, tenantId);

    // Gracefully handle already-enrolled case so the same link can be used by multiple students
    const existing = await this.enrollmentRepo.findOne({
      where: { tenantId, batchId: payload.batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    if (existing) {
      return { message: 'You are already enrolled in this batch' };
    }

    await this.enrollStudent(payload.batchId, { studentId: student.id }, tenantId);
    // Token is NOT deleted — link is multi-use (valid for 7 days)
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

    // Duplicate checks
    const existingPhone = await this.userRepo.findOne({ where: { phoneNumber: dto.phoneNumber, tenantId } });
    if (existingPhone) throw new ConflictException('A user with this phone number already exists in this tenant');

    const existingEmail = await this.userRepo.findOne({ where: { email: dto.email, tenantId } });
    if (existingEmail) throw new ConflictException('A user with this email already exists in this tenant');

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (tenant?.maxStudents) {
      const currentCount = await this.studentRepo.count({ where: { tenantId } });
      if (currentCount >= tenant.maxStudents) {
        throw new BadRequestException(`Student limit reached (${tenant.maxStudents}). Upgrade your plan to add more students.`);
      }
    }

    const tempPassword = this.generateTempPassword();

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        phoneNumber: dto.phoneNumber,
        fullName: dto.fullName,
        email: dto.email,
        password: tempPassword,
        tenantId,
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        isFirstLogin: true,
        phoneVerified: true,
        emailVerified: true,
      });
      await manager.save(user);

      const student = manager.create(Student, {
        userId: user.id,
        tenantId,
        examTarget: ExamTarget.BOTH,
        class: StudentClass.CLASS_11,
        examYear: ExamYear.Y2026,
        subscriptionPlan: SubscriptionPlan.INSTITUTE,
      });
      await manager.save(student);

      await manager.save(
        manager.create(Enrollment, { tenantId, batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE }),
      );

      const instituteName = tenant?.name || 'EDVA';
      this.mailService.sendCredentials(dto.email, dto.fullName, dto.email, tempPassword, instituteName)
        .catch(err => this.logger.error(`Failed sending student credentials: ${err.message}`));

      const { password: _pw, ...safeUser } = user as any;
      return { student: { ...safeUser }, tempPassword, message: 'Student created and enrolled.' };
    });
  }

  async bulkCreateAndEnrollStudents(batchId: string, dto: BulkCreateBatchStudentsDto, tenantId: string) {
    const batch = await this.getBatchOrThrow(batchId, tenantId);
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const instituteName = tenant?.name || 'EDVA';

    const results: { fullName: string; email: string; tempPassword: string; status: string; error?: string }[] = [];

    for (const s of dto.students) {
      try {
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
          status: UserStatus.ACTIVE,
          isFirstLogin: true,
          phoneVerified: true,
          emailVerified: true,
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

  // ---------------------------------------------------------------------------
  // Feature additions: Notifications & Payments
  // ---------------------------------------------------------------------------

  async trackBatchView(batchId: string, userId: string, _tenantId: string) {
    // Fire & forget — cross-tenant safe
    (async () => {
      try {
        // Look up batch without tenant restriction (students can browse any institute's courses)
        const batch = await this.batchRepo.findOne({ where: { id: batchId } });
        if (!batch) return;

        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) return;

        // Only notify when the student is NOT already enrolled
        const student = await this.studentRepo.findOne({ where: { userId } });
        if (student) {
          const enrolled = await this.enrollmentRepo.findOne({
            where: { batchId, studentId: student.id },
          });
          if (enrolled) return; // already enrolled — skip notification
        }

        // Notify admins of the COURSE's institute (batch.tenantId), not the student's tenant
        const admins = await this.userRepo.find({
          where: { tenantId: batch.tenantId, role: UserRole.INSTITUTE_ADMIN, status: UserStatus.ACTIVE },
        });

        const phone = user.phoneNumber ?? 'N/A';
        const body =
          `📚 ${user.fullName} is interested in "${batch.name}"\n` +
          `📞 Phone: ${phone}` +
          (user.email ? `\n✉️  Email: ${user.email}` : '');

        for (const admin of admins) {
          await this.notificationService.send({
            userId: admin.id,
            tenantId: batch.tenantId,
            title: `Lead: ${user.fullName} viewed your course`,
            body,
            channels: ['in_app'],
            refType: 'course_view',
            refId: batch.id,
          });
        }
      } catch (err) {
        // Swallow background error
        this.logger.warn(`trackBatchView error: ${(err as any)?.message ?? err}`);
      }
    })();
    return { tracked: true };
  }

  getRazorpayInstance() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new InternalServerErrorException('Razorpay config is missing');
    }
    return new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  async createCheckoutOrder(batchId: string, userId: string, tenantId: string) {
    // Look up batch without tenant filter — students can buy batches cross-institute
    const batch = await this.batchRepo.findOne({ where: { id: batchId }, relations: ['teacher'] });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    if (!batch.isPaid || !batch.feeAmount) {
      throw new BadRequestException('This course is free');
    }

    const student = await this.getStudentByUserId(userId, tenantId);
    const existingEnrollment = await this.enrollmentRepo.findOne({
      where: { batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    if (existingEnrollment) {
      throw new ConflictException('You are already enrolled in this course');
    }

    const rzp = this.getRazorpayInstance();
    const order = await rzp.orders.create({
      amount: batch.feeAmount * 100, // in paise
      currency: 'INR',
      receipt: `rcpt_${batch.id.substring(0, 8)}_${Date.now()}`,
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
    };
  }

  async verifyAndEnroll(batchId: string, userId: string, tenantId: string, dto: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      throw new InternalServerErrorException('Razorpay secret missing');
    }

    const expectedSignature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(dto.razorpay_order_id + '|' + dto.razorpay_payment_id)
      .digest('hex');

    if (expectedSignature !== dto.razorpay_signature) {
      throw new BadRequestException('Invalid payment signature');
    }

    // Look up batch without tenant filter (cross-institute support)
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    const student = await this.getStudentByUserId(userId, tenantId);

    // Idempotency: if already enrolled, return existing
    const existing = await this.enrollmentRepo.findOne({
      where: { batchId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    if (existing) return existing;

    // Enroll using batch's tenantId and record payment
    const enrollment = await this.enrollmentRepo.save(
      this.enrollmentRepo.create({
        tenantId: batch.tenantId,
        batchId,
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
        feePaid: batch.feeAmount,
        feePaidAt: new Date(),
      }),
    );

    // Record payment transaction for admin reporting
    try {
      const commissionPct = Number(batch.platformFeePercent ?? 5);
      const amount = Number(batch.feeAmount ?? 0);
      const commissionAmount = Math.round(amount * commissionPct) / 100;
      const netAmount = amount - commissionAmount;

      const [studentUser, tenant] = await Promise.all([
        this.userRepo.findOne({ where: { id: userId } }),
        this.tenantRepo.findOne({ where: { id: batch.tenantId } }),
      ]);

      await this.paymentTxRepo.save(this.paymentTxRepo.create({
        tenantId: batch.tenantId,
        batchId,
        studentId: student.id,
        enrollmentId: enrollment.id,
        amount,
        commissionPercent: commissionPct,
        commissionAmount,
        netAmount,
        razorpayOrderId: dto.razorpay_order_id,
        razorpayPaymentId: dto.razorpay_payment_id,
        status: PaymentStatus.SUCCESS,
        batchName: batch.name,
        studentName: studentUser?.fullName ?? null,
        instituteName: tenant?.name ?? null,
      }));
    } catch (err) {
      this.logger.warn(`Failed to save payment transaction: ${(err as any)?.message}`);
    }

    return enrollment;
  }
}
