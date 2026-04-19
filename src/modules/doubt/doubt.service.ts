import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { NotificationService } from '../notification/notification.service';
import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Student } from '../../database/entities/student.entity';
import { Topic } from '../../database/entities/subject.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import {
  Doubt,
  DoubtSource,
  DoubtStatus,
  ExplanationMode,
} from '../../database/entities/learning.entity';

import {
  CreateDoubtDto,
  DoubtListQueryDto,
  MarkDoubtHelpfulDto,
  MarkDoubtReviewedDto,
  RateTeacherResponseDto,
  TeacherResponseDto,
} from './dto/doubt.dto';
import { toJsonSafeDeep } from '../../common/utils/json-safe';

@Injectable()
export class DoubtService {
  private readonly logger = new Logger(DoubtService.name);

  constructor(
    @InjectRepository(Doubt)
    private readonly doubtRepo: Repository<Doubt>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: NotificationService,
  ) {}

  async createDoubt(dto: CreateDoubtDto, userId: string, tenantId: string) {
    if (!dto.questionText && !dto.questionImageUrl) {
      throw new BadRequestException('Either questionText or questionImageUrl is required');
    }

    const student = await this.getStudentByUserId(userId, tenantId);
    let topic: Topic | null = null;
    if (dto.topicId) {
      topic = await this.topicRepo.findOne({ where: { id: dto.topicId } });
      if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);
    }

    let batchId = dto.batchId ?? null;
    if (!batchId) {
      const ens = await this.enrollmentRepo.find({
        where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
        relations: ['batch'],
        order: { enrolledAt: 'DESC' },
      });
      // Prefer an institute batch (tenant ≠ request tenant) so doubts land in the teacher queue.
      const preferred =
        ens.find((e) => e.batch?.tenantId && e.batch.tenantId !== tenantId) ?? ens[0];
      batchId = preferred?.batchId ?? null;
    }

    // Institute enrollments live on the batch's tenant; JWT may still be "platform".
    let doubtTenantId = tenantId;
    if (batchId) {
      const batch = await this.batchRepo.findOne({ where: { id: batchId } });
      if (batch?.tenantId) doubtTenantId = batch.tenantId;
    }

    const skipAi = !!dto.skipAI;
    const initialStatus = skipAi ? DoubtStatus.ESCALATED : DoubtStatus.OPEN;

    const doubt = await this.doubtRepo.save(
      this.doubtRepo.create({
        tenantId: doubtTenantId,
        studentId: student.id,
        topicId: dto.topicId ?? null,
        batchId,
        questionText: dto.questionText ?? null,
        questionImageUrl: dto.questionImageUrl ?? null,
        source: dto.source,
        sourceRefId: dto.sourceRefId ?? null,
        explanationMode: dto.explanationMode,
        status: initialStatus,
      }),
    );

    if (skipAi) {
      await this.notifyEscalatedDoubtTeachers(doubt);
    } else {
      try {
        const aiResult = (await this.aiBridgeService.resolveDoubt({
          questionText: dto.questionText || dto.questionImageUrl || '',
          topicId: dto.topicId,
          mode: dto.explanationMode as 'short' | 'detailed',
          studentContext: { source: dto.source, sourceRefId: dto.sourceRefId },
        })) as {
          explanation?: string;
          answer?: string;
          conceptLinks?: string[];
          key_concepts?: string[];
          similarQuestionIds?: string[];
        };

        // Django returns "answer" + "key_concepts"; fall back to alternate field names
        doubt.aiExplanation = aiResult?.explanation ?? aiResult?.answer ?? null;
        doubt.aiConceptLinks = aiResult?.conceptLinks ?? aiResult?.key_concepts ?? [];
        doubt.aiSimilarQuestionIds = aiResult?.similarQuestionIds ?? [];
        doubt.status = DoubtStatus.AI_RESOLVED;
        await this.doubtRepo.save(doubt);
      } catch {
        // AI service unavailable — escalate to teacher instead of crashing
        doubt.status = DoubtStatus.ESCALATED;
        await this.doubtRepo.save(doubt);
        await this.notifyEscalatedDoubtTeachers(doubt);
      }
    }

    return this.getDoubtWithRelations(doubt.id);
  }

  async getDoubts(query: DoubtListQueryDto, user: any, tenantId: string) {
    const page = query.page || 1;
    const limit = Math.min(query.limit ?? 100, 200);
    const skip = (page - 1) * limit;

    const qb = this.doubtRepo
      .createQueryBuilder('doubt')
      .leftJoinAndSelect('doubt.student', 'student')
      .leftJoinAndSelect('student.user', 'studentUser')
      .leftJoinAndSelect('doubt.topic', 'topic')
      .leftJoinAndSelect('topic.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .leftJoinAndSelect('doubt.batch', 'batch')
      .andWhere('doubt.deletedAt IS NULL');

    // Students are one row per user; doubts for institute batches use the batch tenant,
    // so list by studentId instead of JWT tenant to include institute-queued doubts.
    if (user.role !== UserRole.STUDENT) {
      qb.andWhere('doubt.tenantId = :tenantId', { tenantId });
    }

    if (query.status) qb.andWhere('doubt.status = :status', { status: query.status });
    if (query.topicId) qb.andWhere('doubt.topicId = :topicId', { topicId: query.topicId });
    if (query.batchId) qb.andWhere('doubt.batchId = :batchId', { batchId: query.batchId });

    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      qb.andWhere('doubt.studentId = :studentId', { studentId: student.id });
    } else if (user.role === UserRole.TEACHER) {
      const [batchIds, studentIds] = await Promise.all([
        this.getTeacherBatchIds(user.id, tenantId, query.batchId),
        this.getTeacherStudentIds(user.id, tenantId, query.batchId),
      ]);
      // When the teacher is not yet linked on batches / roster, still show tenant doubts
      // (same rows students see under institute tenant) so the UI is not empty.
      if (batchIds.length || studentIds.length) {
        if (batchIds.length && studentIds.length) {
          qb.andWhere(
            '(doubt.batchId IN (:...batchIds) OR doubt.studentId IN (:...studentIds))',
            { batchIds, studentIds },
          );
        } else if (batchIds.length) {
          qb.andWhere('doubt.batchId IN (:...batchIds)', { batchIds });
        } else {
          qb.andWhere('doubt.studentId IN (:...studentIds)', { studentIds });
        }
      }
    } else if (query.studentId) {
      qb.andWhere('doubt.studentId = :studentId', { studentId: query.studentId });
    }

    qb.orderBy('doubt.createdAt', 'DESC').skip(skip).take(limit);
    const [data, total] = await qb.getManyAndCount();

    return {
      data: data.map((doubt) => this.serializeDoubt(doubt)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async getDoubtById(id: string, user: any, tenantId: string) {
    const doubt = await this.getDoubtWithRelations(id);
    await this.assertCanAccessDoubt(doubt, user, tenantId);
    return this.serializeDoubt(doubt);
  }

  async markHelpful(id: string, dto: MarkDoubtHelpfulDto, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const doubt = await this.getDoubtWithRelations(id);
    if (doubt.studentId !== student.id) {
      throw new ForbiddenException('You can only update your own doubts');
    }

    doubt.isHelpful = dto.isHelpful;
    if (dto.isHelpful) {
      doubt.resolvedAt = new Date();
    } else if (doubt.status === DoubtStatus.AI_RESOLVED) {
      doubt.status = DoubtStatus.ESCALATED;
      await this.notifyEscalatedDoubtTeachers(doubt);
    }

    await this.doubtRepo.save(doubt);
    return this.serializeDoubt(doubt);
  }

  async addTeacherResponse(id: string, dto: TeacherResponseDto, userId: string, tenantId: string) {
    const doubt = await this.getDoubtWithRelations(id);
    const canHandle = await this.canTeacherHandleDoubt(doubt, userId, tenantId);
    if (!canHandle) throw new ForbiddenException('You are not assigned to this doubt');

    const teacher = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!teacher) throw new NotFoundException('Teacher not found');

    doubt.teacherId = userId;
    doubt.teacherResponse = dto.teacherResponse;
    doubt.status = DoubtStatus.TEACHER_RESOLVED;
    doubt.resolvedAt = new Date();
    if (dto.aiQualityRating) doubt.aiQualityRating = dto.aiQualityRating;
    if (dto.lectureRef) doubt.teacherLectureRef = dto.lectureRef;
    if (dto.responseImageUrl) doubt.teacherResponseImageUrl = dto.responseImageUrl;
    await this.doubtRepo.save(doubt);

    const student = await this.studentRepo.findOne({
      where: { id: doubt.studentId },
      relations: ['user'],
    });
    const notifyTenantId = student?.user?.tenantId ?? doubt.tenantId;
    if (student?.userId) {
      await this.notificationService.send({
        userId: student.userId,
        tenantId: notifyTenantId,
        title: `${teacher.fullName} answered your doubt ✅`,
        body: dto.teacherResponse.slice(0, 120),
        channels: ['push', 'in_app'],
        refType: 'doubt_answered',
        refId: doubt.id,
      });
    }

    return this.serializeDoubt(doubt);
  }

  async markAsReviewed(id: string, dto: MarkDoubtReviewedDto, userId: string, tenantId: string) {
    const doubt = await this.getDoubtWithRelations(id);
    const canHandle = await this.canTeacherHandleDoubt(doubt, userId, tenantId);
    if (!canHandle) throw new ForbiddenException('You are not assigned to this doubt');

    const teacher = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!teacher) throw new NotFoundException('Teacher not found');

    doubt.teacherId = userId;
    doubt.aiQualityRating = dto.aiQualityRating ?? 'correct';
    doubt.status = DoubtStatus.TEACHER_RESOLVED;
    doubt.teacherReviewedAt = new Date();
    doubt.resolvedAt = new Date();
    await this.doubtRepo.save(doubt);

    const student = await this.studentRepo.findOne({
      where: { id: doubt.studentId },
      relations: ['user'],
    });
    const notifyTenantId = student?.user?.tenantId ?? doubt.tenantId;
    if (student?.userId) {
      await this.notificationService.send({
        userId: student.userId,
        tenantId: notifyTenantId,
        title: `${teacher.fullName} verified your AI answer ✅`,
        body: `The AI explanation for your doubt was confirmed correct by ${teacher.fullName}.`,
        channels: ['in_app'],
        refType: 'doubt_reviewed',
        refId: doubt.id,
      });
    }

    return this.serializeDoubt(doubt);
  }

  async requestAiResolution(id: string, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const doubt = await this.getDoubtWithRelations(id);

    if (doubt.studentId !== student.id) {
      throw new ForbiddenException('You can only update your own doubts');
    }
    if (
      doubt.status === DoubtStatus.AI_RESOLVED ||
      doubt.status === DoubtStatus.TEACHER_RESOLVED
    ) {
      throw new BadRequestException('This doubt is already resolved');
    }

    try {
      const aiResult = (await this.aiBridgeService.resolveDoubt({
        questionText: doubt.questionText || doubt.questionImageUrl || '',
        topicId: doubt.topicId || undefined,
        mode: ((doubt.explanationMode as string) || 'short') as 'short' | 'detailed',
        studentContext: { source: doubt.source, sourceRefId: doubt.sourceRefId ?? undefined },
      })) as any;

      doubt.aiExplanation = aiResult?.explanation ?? aiResult?.answer ?? null;
      doubt.aiConceptLinks = aiResult?.conceptLinks ?? aiResult?.key_concepts ?? [];
      doubt.aiSimilarQuestionIds = aiResult?.similarQuestionIds ?? [];
      doubt.status = DoubtStatus.AI_RESOLVED;
      await this.doubtRepo.save(doubt);
    } catch {
      throw new BadRequestException('AI service is temporarily unavailable. Please try again later.');
    }

    return this.serializeDoubt(doubt);
  }

  async rateTeacherResponse(id: string, dto: RateTeacherResponseDto, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const doubt = await this.getDoubtWithRelations(id);
    if (doubt.studentId !== student.id) throw new ForbiddenException('You can only rate your own doubts');
    if (doubt.status !== DoubtStatus.TEACHER_RESOLVED) {
      throw new BadRequestException('Doubt has not been resolved by teacher yet');
    }

    doubt.isTeacherResponseHelpful = dto.isHelpful;
    if (!dto.isHelpful) {
      doubt.status = DoubtStatus.ESCALATED;
      doubt.resolvedAt = null;
      await this.notifyEscalatedDoubtTeachers(doubt);
    }
    await this.doubtRepo.save(doubt);
    return this.serializeDoubt(doubt);
  }

  async getTeacherQueue(userId: string, tenantId: string, role?: string, scopeBatchId?: string) {
    const qb = this.doubtRepo
      .createQueryBuilder('doubt')
      .leftJoinAndSelect('doubt.student', 'student')
      .leftJoinAndSelect('student.user', 'studentUser')
      .leftJoinAndSelect('doubt.topic', 'topic')
      .leftJoinAndSelect('topic.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .leftJoinAndSelect('doubt.batch', 'batch')
      .where('doubt.tenantId = :tenantId', { tenantId })
      .andWhere('doubt.status = :status', { status: DoubtStatus.ESCALATED })
      .andWhere('doubt.deletedAt IS NULL');

    if (scopeBatchId) {
      qb.andWhere('doubt.batchId = :scopeBatchId', { scopeBatchId });
    }

    if (role !== UserRole.INSTITUTE_ADMIN) {
      const [batchIds, studentIds] = await Promise.all([
        this.getTeacherBatchIds(userId, tenantId, scopeBatchId),
        this.getTeacherStudentIds(userId, tenantId, scopeBatchId),
      ]);

      this.logger.debug(
        `getTeacherQueue userId=${userId} batchIds=${batchIds.length} studentIds=${studentIds.length}`,
      );

      // Show doubt if batchId matches the teacher's batch (new doubts)
      // OR studentId is an enrolled student (legacy doubts without batchId)
      // If neither is set (teacher not linked on batches yet), show all escalated for this tenant.
      if (batchIds.length && studentIds.length) {
        qb.andWhere(
          '(doubt.batchId IN (:...batchIds) OR doubt.studentId IN (:...studentIds))',
          { batchIds, studentIds },
        );
      } else if (batchIds.length) {
        qb.andWhere('doubt.batchId IN (:...batchIds)', { batchIds });
      } else if (studentIds.length) {
        qb.andWhere('doubt.studentId IN (:...studentIds)', { studentIds });
      }
    }

    const doubts = await qb.orderBy('doubt.createdAt', 'ASC').getMany();

    return doubts.map((doubt) => ({
      ...this.serializeDoubt(doubt),
      timeSinceAskedMinutes: Math.max(
        0,
        Math.floor((Date.now() - new Date(doubt.createdAt).getTime()) / 60000),
      ),
    }));
  }

  private async getDoubtWithRelations(id: string) {
    const doubt = await this.doubtRepo.findOne({
      where: { id },
      relations: ['student', 'student.user', 'topic', 'topic.chapter', 'topic.chapter.subject', 'batch'],
    });
    if (!doubt) throw new NotFoundException(`Doubt ${id} not found`);
    return doubt;
  }

  private async assertCanAccessDoubt(doubt: Doubt, user: any, tenantId: string) {
    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      if (doubt.studentId !== student.id) {
        throw new ForbiddenException('You can only view your own doubts');
      }
      return;
    }

    if (user.role === UserRole.TEACHER) {
      const canHandle = await this.canTeacherHandleDoubt(doubt, user.id, tenantId);
      if (!canHandle) throw new ForbiddenException('You do not have access to this doubt');
      return;
    }

    if (user.role === UserRole.INSTITUTE_ADMIN && doubt.tenantId !== tenantId) {
      throw new ForbiddenException('You do not have access to this doubt');
    }
  }

  private async canTeacherHandleDoubt(doubt: Doubt, userId: string, tenantId: string) {
    const actor = await this.userRepo.findOne({ where: { id: userId } });
    if (!actor) return false;

    if (actor.role === UserRole.INSTITUTE_ADMIN && doubt.tenantId === tenantId) {
      return true;
    }

    const [batchIds, studentIds] = await Promise.all([
      this.getTeacherBatchIds(userId, tenantId),
      this.getTeacherStudentIds(userId, tenantId),
    ]);
    if (doubt.batchId != null && batchIds.includes(doubt.batchId)) return true;
    if (studentIds.includes(doubt.studentId)) return true;

    // Escalated pool: any TEACHER in this institute may answer (covers missing batch_subject_teachers rows).
    if (
      actor.role === UserRole.TEACHER &&
      doubt.tenantId === tenantId &&
      doubt.status === DoubtStatus.ESCALATED
    ) {
      return true;
    }

    return false;
  }

  private async getTeacherBatchIds(userId: string, tenantId: string, scopeBatchId?: string): Promise<string[]> {
    const [primaryBatches, subjectAssignments] = await Promise.all([
      this.batchRepo.find({ where: { tenantId, teacherId: userId } }),
      this.batchSubjectTeacherRepo.find({ where: { tenantId, teacherId: userId } }),
    ]);

    this.logger.debug(
      `getTeacherBatchIds userId=${userId} tenantId=${tenantId} primaryBatches=${primaryBatches.length} subjectAssignments=${subjectAssignments.length}`,
    );

    let batchIds = [
      ...new Set([
        ...primaryBatches.map((b) => b.id),
        ...subjectAssignments.map((a) => a.batchId),
      ]),
    ];

    if (scopeBatchId) {
      batchIds = batchIds.filter((id) => id === scopeBatchId);
    }

    return batchIds;
  }

  private async getTeacherStudentIds(userId: string, tenantId: string, scopeBatchId?: string): Promise<string[]> {
    const batchIds = await this.getTeacherBatchIds(userId, tenantId, scopeBatchId);

    if (!batchIds.length) return [];

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId: In(batchIds), status: EnrollmentStatus.ACTIVE },
    });

    this.logger.debug(
      `getTeacherStudentIds batchIds=${batchIds.join(',')} enrollments=${enrollments.length}`,
    );

    return [...new Set(enrollments.map((e) => e.studentId))];
  }

  private async notifyEscalatedDoubtTeachers(doubt: Doubt) {
    const topic = doubt.topicId
      ? await this.topicRepo.findOne({
          where: { id: doubt.topicId },
          relations: ['chapter', 'chapter.subject'],
        })
      : null;

    const teacherIdSet = new Set<string>();

    // Determine which batches to look at:
    // If batchId is stored on the doubt (student selected a specific course), use only that batch.
    // Otherwise fall back to all active enrollments for the student.
    let batchIds: string[] = [];
    if (doubt.batchId) {
      batchIds = [doubt.batchId];
    } else {
      const enrollments = await this.enrollmentRepo.find({
        where: {
          tenantId: doubt.tenantId,
          studentId: doubt.studentId,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      batchIds = enrollments.map((e) => e.batchId);
    }

    if (!batchIds.length) {
      this.logger.warn(`notifyEscalatedDoubtTeachers: no batches found for doubt ${doubt.id}`);
    } else {
      const batches = await this.batchRepo.find({
        where: { id: In(batchIds), tenantId: doubt.tenantId },
      });

      // Add primary batch teacher(s)
      for (const b of batches) {
        if (b.teacherId) teacherIdSet.add(b.teacherId);
      }

      // Add subject-specific teachers from batch_subject_teachers.
      // Match by subject name (normalized). We use the topic's subject name
      // because BatchSubjectTeacher stores a string subject name too.
      const subjectName = topic?.chapter?.subject?.name;
      const subjectAssignments = await this.batchSubjectTeacherRepo.find({
        where: { batchId: In(batchIds), tenantId: doubt.tenantId },
      });
      for (const a of subjectAssignments) {
        const match =
          !subjectName ||
          a.subjectName?.trim().toLowerCase() === subjectName.trim().toLowerCase();
        if (match) teacherIdSet.add(a.teacherId);
      }
      // If no subject-matched teachers (naming mismatch), notify all teachers assigned to the batch
      const matchedAny = subjectAssignments.some(
        (a) =>
          !subjectName ||
          a.subjectName?.trim().toLowerCase() === subjectName?.trim().toLowerCase(),
      );
      if (subjectName && subjectAssignments.length > 0 && !matchedAny) {
        for (const a of subjectAssignments) teacherIdSet.add(a.teacherId);
      }
    }

    // Always notify institute admins in the tenant
    const admins = await this.userRepo.find({
      where: { tenantId: doubt.tenantId, role: UserRole.INSTITUTE_ADMIN },
    });
    for (const admin of admins) {
      teacherIdSet.add(admin.id);
    }

    if (!teacherIdSet.size) {
      this.logger.warn(`notifyEscalatedDoubtTeachers: no recipients found for doubt ${doubt.id}`);
      return;
    }

    const recipients = await this.userRepo.find({
      where: { id: In([...teacherIdSet]), tenantId: doubt.tenantId },
    });

    const topicLabel = topic?.name || 'Unknown topic';
    const subjectName = topic?.chapter?.subject?.name;
    const subjectLabel = subjectName ? ` (${subjectName})` : '';

    for (const recipient of recipients) {
      await this.notificationService.send({
        userId: recipient.id,
        tenantId: recipient.tenantId,
        title: `New doubt from a student${subjectLabel}`,
        body: `Topic: ${topicLabel} — "${(doubt.questionText || '').slice(0, 80)}"`,
        channels: ['push', 'in_app'],
        refType: 'doubt_escalated',
        refId: doubt.id,
      });
    }
  }

  /** One student row per user (unique user_id); enrollments may be on other tenants' batches. */
  private async getStudentByUserId(userId: string, _tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private serializeDoubt(doubt: Doubt) {
    const st = doubt.student;
    const usr = st?.user;
    const tp = doubt.topic;
    const ch = tp?.chapter;
    const sub = ch?.subject;
    const b = doubt.batch;

    return toJsonSafeDeep({
      id: doubt.id,
      tenantId: doubt.tenantId,
      studentId: doubt.studentId,
      topicId: doubt.topicId,
      batchId: doubt.batchId,
      questionText: doubt.questionText,
      questionImageUrl: doubt.questionImageUrl,
      ocrExtractedText: doubt.ocrExtractedText,
      source: doubt.source,
      sourceRefId: doubt.sourceRefId,
      explanationMode: doubt.explanationMode,
      status: doubt.status,
      aiExplanation: doubt.aiExplanation,
      aiConceptLinks: doubt.aiConceptLinks ?? [],
      aiSimilarQuestionIds: doubt.aiSimilarQuestionIds ?? [],
      teacherId: doubt.teacherId,
      teacherResponse: doubt.teacherResponse,
      isHelpful: doubt.isHelpful,
      resolvedAt: doubt.resolvedAt,
      aiQualityRating: doubt.aiQualityRating,
      teacherLectureRef: doubt.teacherLectureRef,
      teacherResponseImageUrl: doubt.teacherResponseImageUrl,
      isTeacherResponseHelpful: doubt.isTeacherResponseHelpful,
      teacherReviewedAt: doubt.teacherReviewedAt,
      createdAt: doubt.createdAt,
      updatedAt: doubt.updatedAt,
      topicName: tp?.name ?? null,
      chapterName: ch?.name ?? null,
      subjectName: sub?.name ?? null,
      studentName: usr?.fullName ?? null,
      batchName: b?.name ?? null,
      student:
        st && usr
          ? {
              id: st.id,
              fullName: usr.fullName,
              phoneNumber: usr.phoneNumber,
            }
          : undefined,
      topic: tp
        ? {
            id: tp.id,
            name: tp.name,
            chapter: ch
              ? {
                  name: ch.name,
                  subject: sub ? { name: sub.name } : undefined,
                }
              : undefined,
          }
        : undefined,
    }) as Record<string, unknown>;
  }
}
