import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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

@Injectable()
export class DoubtService {
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
      topic = await this.topicRepo.findOne({ where: { id: dto.topicId, tenantId } });
      if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);
    }

    const doubt = await this.doubtRepo.save(
      this.doubtRepo.create({
        tenantId,
        studentId: student.id,
        topicId: dto.topicId ?? null,
        questionText: dto.questionText ?? null,
        questionImageUrl: dto.questionImageUrl ?? null,
        source: dto.source,
        sourceRefId: dto.sourceRefId ?? null,
        explanationMode: dto.explanationMode,
        status: DoubtStatus.OPEN,
      }),
    );

    if (dto.skipAI) {
      // Forward directly to teacher — skip AI
      doubt.status = DoubtStatus.ESCALATED;
      await this.doubtRepo.save(doubt);
      await this.notifyEscalatedDoubtTeachers(doubt);
    } else {
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
    }

    return this.getDoubtWithRelations(doubt.id, topic?.tenantId || tenantId);
  }

  async getDoubts(query: DoubtListQueryDto, user: any, tenantId: string) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.doubtRepo
      .createQueryBuilder('doubt')
      .leftJoinAndSelect('doubt.student', 'student')
      .leftJoinAndSelect('student.user', 'studentUser')
      .leftJoinAndSelect('doubt.topic', 'topic')
      .leftJoinAndSelect('topic.chapter', 'chapter')
      .leftJoinAndSelect('chapter.subject', 'subject')
      .where('doubt.tenantId = :tenantId', { tenantId })
      .andWhere('doubt.deletedAt IS NULL');

    if (query.status) qb.andWhere('doubt.status = :status', { status: query.status });
    if (query.topicId) qb.andWhere('doubt.topicId = :topicId', { topicId: query.topicId });

    if (user.role === UserRole.STUDENT) {
      const student = await this.getStudentByUserId(user.id, tenantId);
      qb.andWhere('doubt.studentId = :studentId', { studentId: student.id });
    } else if (user.role === UserRole.TEACHER) {
      const studentIds = await this.getTeacherStudentIds(user.id, tenantId);
      if (!studentIds.length) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
      }
      qb.andWhere('doubt.studentId IN (:...studentIds)', { studentIds });
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
    const doubt = await this.getDoubtWithRelations(id, tenantId);
    await this.assertCanAccessDoubt(doubt, user, tenantId);
    return this.serializeDoubt(doubt);
  }

  async markHelpful(id: string, dto: MarkDoubtHelpfulDto, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const doubt = await this.getDoubtWithRelations(id, tenantId);
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
    const doubt = await this.getDoubtWithRelations(id, tenantId);
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
      where: { id: doubt.studentId, tenantId },
      relations: ['user'],
    });
    if (student?.userId) {
      await this.notificationService.send({
        userId: student.userId,
        tenantId,
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
    const doubt = await this.getDoubtWithRelations(id, tenantId);
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
      where: { id: doubt.studentId, tenantId },
      relations: ['user'],
    });
    if (student?.userId) {
      await this.notificationService.send({
        userId: student.userId,
        tenantId,
        title: `${teacher.fullName} verified your AI answer ✅`,
        body: `The AI explanation for your doubt was confirmed correct by ${teacher.fullName}.`,
        channels: ['in_app'],
        refType: 'doubt_reviewed',
        refId: doubt.id,
      });
    }

    return this.serializeDoubt(doubt);
  }

  async rateTeacherResponse(id: string, dto: RateTeacherResponseDto, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const doubt = await this.getDoubtWithRelations(id, tenantId);
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

  async getTeacherQueue(userId: string, tenantId: string) {
    const studentIds = await this.getTeacherStudentIds(userId, tenantId);
    if (!studentIds.length) return [];

    const doubts = await this.doubtRepo.find({
      where: {
        tenantId,
        status: DoubtStatus.ESCALATED,
        studentId: In(studentIds),
      },
      relations: ['student', 'student.user', 'topic'],
      order: { createdAt: 'ASC' },
    });

    return doubts.map((doubt) => ({
      ...this.serializeDoubt(doubt),
      studentName: doubt.student?.user?.fullName || null,
      topicName: doubt.topic?.name || null,
      timeSinceAskedMinutes: Math.max(
        0,
        Math.floor((Date.now() - new Date(doubt.createdAt).getTime()) / 60000),
      ),
    }));
  }

  private async getDoubtWithRelations(id: string, tenantId: string) {
    const doubt = await this.doubtRepo.findOne({
      where: { id, tenantId },
      relations: ['student', 'student.user', 'topic', 'topic.chapter', 'topic.chapter.subject'],
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
    }
  }

  private async canTeacherHandleDoubt(doubt: Doubt, userId: string, tenantId: string) {
    const studentIds = await this.getTeacherStudentIds(userId, tenantId);
    return studentIds.includes(doubt.studentId);
  }

  private async getTeacherStudentIds(userId: string, tenantId: string) {
    const [primaryBatches, subjectAssignments] = await Promise.all([
      this.batchRepo.find({ where: { tenantId, teacherId: userId } }),
      this.batchSubjectTeacherRepo.find({ where: { tenantId, teacherId: userId } }),
    ]);

    const batchIds = [
      ...new Set([
        ...primaryBatches.map((b) => b.id),
        ...subjectAssignments.map((a) => a.batchId),
      ]),
    ];

    if (!batchIds.length) return [];

    const enrollments = await this.enrollmentRepo.find({
      where: { tenantId, batchId: In(batchIds), status: EnrollmentStatus.ACTIVE },
    });

    return [...new Set(enrollments.map((e) => e.studentId))];
  }

  private async notifyEscalatedDoubtTeachers(doubt: Doubt) {
    const topic = doubt.topicId
      ? await this.topicRepo.findOne({
          where: { id: doubt.topicId, tenantId: doubt.tenantId },
          relations: ['chapter', 'chapter.subject'],
        })
      : null;

    const enrollments = await this.enrollmentRepo.find({
      where: {
        tenantId: doubt.tenantId,
        studentId: doubt.studentId,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    if (!enrollments.length) return;

    const batches = await this.batchRepo.find({
      where: { id: In(enrollments.map((enrollment) => enrollment.batchId)), tenantId: doubt.tenantId },
    });

    const teacherIds = [...new Set(batches.map((batch) => batch.teacherId).filter(Boolean))];
    const teachers = teacherIds.length
      ? await this.userRepo.find({ where: { id: In(teacherIds), tenantId: doubt.tenantId } })
      : [];

    for (const teacher of teachers) {
      await this.notificationService.send({
        userId: teacher.id,
        tenantId: teacher.tenantId,
        title: `New doubt escalated in your subject: ${topic?.name || 'Unknown topic'}`,
        body: `New doubt escalated in your subject: ${topic?.name || 'Unknown topic'}`,
        channels: ['push', 'in_app'],
        refType: 'doubt_escalated',
        refId: doubt.id,
      });
    }
  }

  private async getStudentByUserId(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private serializeDoubt(doubt: Doubt) {
    return {
      ...doubt,
      topicName: doubt.topic?.name || null,
      studentName: doubt.student?.user?.fullName || null,
      subjectName: doubt.topic?.chapter?.subject?.name || null,
    };
  }
}
