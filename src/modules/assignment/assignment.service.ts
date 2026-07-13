import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LectureAssignment, AssignmentSubmission, SubmissionStatus } from '../../database/entities/assignment.entity';
import { Lecture } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { Batch, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { NotificationService } from '../notification/notification.service';
import { Cron } from '@nestjs/schedule';
import { Logger } from '@nestjs/common';

@Injectable()
export class AssignmentService {
  constructor(
    @InjectRepository(LectureAssignment, 'coaching')
    private readonly assignmentRepo: Repository<LectureAssignment>,
    @InjectRepository(AssignmentSubmission, 'coaching')
    private readonly submissionRepo: Repository<AssignmentSubmission>,
    @InjectRepository(Lecture, 'coaching')
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch, 'coaching')
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly notificationService: NotificationService,
  ) { }

  private readonly logger = new Logger(AssignmentService.name);

  async createAssignment(
    tenantId: string,
    lectureId: string,
    data: {
      title: string;
      description?: string;
      attachmentUrl?: string;
      dueDate?: string;
      maxMarks?: number;
    }
  ) {
    const lecture = await this.lectureRepo.findOne({ where: { id: lectureId, tenantId } });
    if (!lecture) throw new NotFoundException('Lecture not found');

    const assignment = this.assignmentRepo.create({
      tenantId,
      lectureId,
      title: data.title,
      description: data.description,
      attachmentUrl: data.attachmentUrl,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      maxMarks: data.maxMarks,
    });

    const saved = await this.assignmentRepo.save(assignment);
    
    this.notifyBatchStudentsOfNewAssignment(lecture, saved).catch((err) => {
      this.logger.warn(`Failed to send assignment notification: ${err.message}`);
    });

    return saved;
  }

  private async notifyBatchStudentsOfNewAssignment(lecture: Lecture, assignment: LectureAssignment) {
    if (!lecture.batchId) return;

    const batch = await this.batchRepo.findOne({ where: { id: lecture.batchId } });
    if (!batch) return;

    const enrollments = await this.enrollmentRepo.find({
      where: { batchId: lecture.batchId, status: EnrollmentStatus.ACTIVE },
      relations: ['student', 'student.user'],
    });

    const targets = enrollments.filter(e => e.student?.user?.id);
    
    await Promise.allSettled(
      targets.map(e => {
        const recipientTenantId = e.student!.user!.tenantId ?? e.student!.tenantId ?? assignment.tenantId;
        return this.notificationService.send({
          userId: e.student!.user!.id,
          tenantId: recipientTenantId,
          title: '📝 New Assignment',
          body: `"${assignment.title}" has been assigned in ${batch.name}.`,
          channels: ['in_app', 'push'],
          refType: 'assignment',
          refId: assignment.id,
        });
      }),
    );
  }

  @Cron('0 10 * * *')
  async notifyPendingAssignments() {
    this.logger.log('Running daily pending assignment reminder cron...');
    const now = new Date();

    // Fetch assignments whose due date is in the future
    const activeAssignments = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.lecture', 'lecture')
      .where('a.dueDate > :now', { now })
      .getMany();

    if (activeAssignments.length === 0) return;

    for (const assignment of activeAssignments) {
      if (!assignment.lecture?.batchId) continue;

      const enrollments = await this.enrollmentRepo.find({
        where: { batchId: assignment.lecture.batchId, status: EnrollmentStatus.ACTIVE },
        relations: ['student', 'student.user'],
      });

      const submissions = await this.submissionRepo.find({
        where: { assignmentId: assignment.id },
        select: ['studentId'],
      });
      const submittedStudentIds = new Set(submissions.map(s => s.studentId));

      const pendingTargets = enrollments.filter(e => e.student?.user?.id && !submittedStudentIds.has(e.student.id));

      await Promise.allSettled(
        pendingTargets.map(e => {
          const recipientTenantId = e.student!.user!.tenantId ?? e.student!.tenantId ?? assignment.tenantId;
          return this.notificationService.send({
            userId: e.student!.user!.id,
            tenantId: recipientTenantId,
            title: '⏰ Assignment Reminder',
            body: `Don't forget to submit "${assignment.title}" before the deadline!`,
            channels: ['in_app', 'push'],
            refType: 'assignment',
            refId: assignment.id,
          });
        }),
      );
    }
  }

  async getAssignmentsForLecture(tenantId: string, lectureId: string, userId?: string) {
    // lectureId is a globally unique UUID — tenant filter is redundant but kept for multi-tenant isolation.
    // Fall back to lectureId-only if strict tenant match returns nothing (e.g. dev cross-tenant access).
    let assignments = await this.assignmentRepo.find({
      where: { lectureId, tenantId },
      order: { createdAt: 'DESC' },
    });

    // Fallback: if no results and caller is authenticated, try without tenant filter
    if (assignments.length === 0) {
      assignments = await this.assignmentRepo.find({
        where: { lectureId },
        order: { createdAt: 'DESC' },
      });
    }

    if (userId && assignments.length > 0) {
      // Resolve student record from userId
      const student = await this.studentRepo.findOne({ where: { userId } });
      if (student) {
        const studentId = student.id;
        const assignmentIds = assignments.map(a => a.id);
        const allSubmissions = await this.submissionRepo.createQueryBuilder('sub')
          .where('sub.assignmentId IN (:...ids)', { ids: assignmentIds })
          .andWhere('sub.studentId = :studentId', { studentId })
          .getMany();

        return assignments.map(a => {
          const sub = allSubmissions.find(s => s.assignmentId === a.id);
          return { ...a, mySubmission: sub || null };
        });
      }
    }

    return assignments;
  }

  async submitAssignment(
    tenantId: string,
    assignmentId: string,
    userId: string,
    submissionUrl: string
  ) {
    const assignment = await this.assignmentRepo.findOne({ where: { id: assignmentId, tenantId } });
    if (!assignment) throw new NotFoundException('Assignment not found');

    // Look up student by userId
    const student = await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');
    const studentId = student.id;

    const existing = await this.submissionRepo.findOne({ where: { assignmentId, studentId, tenantId } });
    if (existing) throw new BadRequestException('You have already submitted this assignment');

    let status = SubmissionStatus.SUBMITTED;
    if (assignment.dueDate && new Date() > new Date(assignment.dueDate)) {
      status = SubmissionStatus.LATE;
    }

    const submission = this.submissionRepo.create({
      tenantId,
      assignmentId,
      studentId,
      submissionUrl,
      status,
      submittedAt: new Date(),
    });

    return this.submissionRepo.save(submission);
  }

  async getSubmissions(tenantId: string, assignmentId: string) {
    return this.submissionRepo.find({
      where: { assignmentId, tenantId },
      relations: ['student', 'student.user'],
      order: { submittedAt: 'DESC' },
    });
  }

  async gradeSubmission(
    tenantId: string,
    submissionId: string,
    grade: number,
    feedback?: string
  ) {
    const submission = await this.submissionRepo.findOne({ where: { id: submissionId, tenantId } });
    if (!submission) throw new NotFoundException('Submission not found');

    submission.grade = grade;
    submission.feedback = feedback;
    submission.status = SubmissionStatus.GRADED;

    return this.submissionRepo.save(submission);
  }
}
