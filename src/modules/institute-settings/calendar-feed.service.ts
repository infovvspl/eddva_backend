import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Lecture, LectureStatus, LectureType } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { UserRole } from '../../database/entities/user.entity';
import { MockTest } from '../../database/entities/assessment.entity';
import { LectureAssignment } from '../../database/entities/assignment.entity';

import { InstituteSettingsService } from './institute-settings.service';

@Injectable()
export class CalendarFeedService {
  constructor(
    private readonly instituteSettings: InstituteSettingsService,
    @InjectRepository(Lecture, 'coaching')
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch, 'coaching')
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(BatchSubjectTeacher, 'coaching')
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(MockTest, 'coaching')
    private readonly mockTestRepo: Repository<MockTest>,
    @InjectRepository(LectureAssignment, 'coaching')
    private readonly assignmentRepo: Repository<LectureAssignment>,
  ) {}

  /** Batches visible on the calendar for this actor; `null` means all batches in the tenant (institute admin). */
  private async resolveBatchScope(
    user: { id: string; role: string },
    tenantId: string,
  ): Promise<string[] | null> {
    if (user.role === UserRole.INSTITUTE_ADMIN) {
      return null;
    }

    if (user.role === UserRole.TEACHER) {
      const [primary, subjectRows] = await Promise.all([
        this.batchRepo.find({ where: { tenantId, teacherId: user.id }, select: ['id'] }),
        this.batchSubjectTeacherRepo.find({ where: { tenantId, teacherId: user.id }, select: ['batchId'] }),
      ]);
      const ids = [...new Set([...primary.map((b) => b.id), ...subjectRows.map((r) => r.batchId)])];
      return ids;
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.studentRepo.findOne({ where: { userId: user.id } });
      if (!student) return [];
      const enrollments = await this.enrollmentRepo.find({
        where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
        select: ['batchId'],
      });
      const enrolledBatchIds = enrollments.map((e) => e.batchId);
      // Fallback for legacy/migrated students where enrollment rows may be missing,
      // but batchId still exists on student profile.
      const fallbackBatchId = (student as any).batchId ? [(student as any).batchId as string] : [];
      return [...new Set([...enrolledBatchIds, ...fallbackBatchId].filter(Boolean))];
    }

    return [];
  }

  async getAggregatedFeed(user: { id: string; role: string }, tenantId: string, year?: number, month?: number) {
    const y = year ?? new Date().getFullYear();
    const m = month ?? new Date().getMonth() + 1;

    const effectiveTenantId = await this.resolveTenantForCalendar(user, tenantId);
    const batchScope = await this.resolveBatchScope(user, tenantId);
    const instituteEvents = await this.instituteSettings.getCalendarEvents(effectiveTenantId, y, m, batchScope);
    const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);

    const lectureWhere: any = {
      type: LectureType.LIVE,
      status: In([LectureStatus.SCHEDULED, LectureStatus.LIVE]),
    };

    if (batchScope === null) {
      lectureWhere.tenantId = effectiveTenantId;
    } else if (batchScope.length === 0) {
      return { instituteEvents, liveClasses: [] };
    } else if (user.role === UserRole.STUDENT) {
      // Enrolled batches may use institute tenant; scope by batch only.
      lectureWhere.batchId = In(batchScope);
    } else {
      lectureWhere.tenantId = effectiveTenantId;
      lectureWhere.batchId = In(batchScope);
    }

    const lectures = await this.lectureRepo.find({
      where: lectureWhere,
      relations: ['batch', 'topic'],
      order: { scheduledAt: 'ASC' },
    });

    const liveClasses = lectures
      .filter((lec) => lec.scheduledAt)
      .filter((lec) => {
        const t = new Date(lec.scheduledAt).getTime();
        return t >= monthStart.getTime() && t <= monthEnd.getTime();
      })
      .map((lec) => ({
        id: lec.id,
        kind: 'live_class' as const,
        title: lec.title,
        date: new Date(lec.scheduledAt).toISOString(),
        scheduledAt: new Date(lec.scheduledAt).toISOString(),
        description: lec.description ?? null,
        type: 'live_class' as const,
        batchId: lec.batchId,
        batchName: lec.batch?.name ?? null,
        topicName: lec.topic?.name ?? null,
        status: lec.status,
        liveMeetingUrl: lec.liveMeetingUrl ?? null,
      }));

    // Assignments
    const assignmentWhere: any = {};
    if (batchScope === null) {
      assignmentWhere.tenantId = effectiveTenantId;
    } else if (batchScope.length > 0) {
      assignmentWhere.lecture = { batchId: In(batchScope) };
    } else {
      assignmentWhere.id = 'none'; // prevent all
    }

    let assignments: LectureAssignment[] = [];
    if (assignmentWhere.id !== 'none') {
      assignments = await this.assignmentRepo.find({
        where: assignmentWhere,
        relations: ['lecture', 'lecture.batch'],
      });
    }

    const assignmentEvents = assignments
      .filter((a) => a.dueDate)
      .filter((a) => {
        const t = new Date(a.dueDate!).getTime();
        return t >= monthStart.getTime() && t <= monthEnd.getTime();
      })
      .map((a) => ({
        id: a.id,
        kind: 'assignment_deadline' as const,
        title: `Deadline: ${a.title}`,
        date: new Date(a.dueDate!).toISOString(),
        scheduledAt: new Date(a.dueDate!).toISOString(),
        description: a.description ?? null,
        type: 'assignment' as const,
        batchId: a.lecture?.batchId ?? null,
        batchName: a.lecture?.batch?.name ?? null,
        lectureId: a.lectureId,
        status: 'scheduled',
      }));

    // Mock Tests
    const mockTestWhere: any = {};
    if (batchScope === null) {
      mockTestWhere.tenantId = effectiveTenantId;
    } else if (batchScope.length > 0) {
      mockTestWhere.batchId = In(batchScope);
    } else {
      mockTestWhere.id = 'none';
    }
    mockTestWhere.isPublished = true;

    let mockTests: MockTest[] = [];
    if (mockTestWhere.id !== 'none') {
      mockTests = await this.mockTestRepo.find({
        where: mockTestWhere,
      });
    }

    const mockTestEvents = mockTests
      .filter((m) => m.deadlineAt)
      .filter((m) => {
        const t = new Date(m.deadlineAt!).getTime();
        return t >= monthStart.getTime() && t <= monthEnd.getTime();
      })
      .map((m) => ({
        id: m.id,
        kind: 'mock_test_deadline' as const,
        title: `Deadline: ${m.title}`,
        date: new Date(m.deadlineAt!).toISOString(),
        scheduledAt: new Date(m.deadlineAt!).toISOString(),
        description: 'Mock Test Deadline',
        type: 'mock_test' as const,
        batchId: m.batchId ?? null,
        batchName: null,
        status: 'scheduled',
      }));

    return { 
      instituteEvents, 
      liveClasses: [...liveClasses, ...assignmentEvents, ...mockTestEvents] 
    };
  }

  private async resolveTenantForCalendar(
    user: { id: string; role: string },
    tenantId: string,
  ): Promise<string> {
    if (user.role !== UserRole.STUDENT) return tenantId;

    const student = await this.studentRepo.findOne({ where: { userId: user.id }, select: ['id', 'tenantId'] });
    if (!student) return tenantId;

    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    });
    return enrollment?.batch?.tenantId ?? student.tenantId ?? tenantId;
  }

  async getVisibleBatches(user: { id: string; role: string }, tenantId: string) {
    const batchScope = await this.resolveBatchScope(user, tenantId);

    const qb = this.batchRepo
      .createQueryBuilder('b')
      .select(['b.id AS "id"', 'b.name AS "name"'])
      .where('b.tenant_id = :tenantId', { tenantId })
      .orderBy('b.name', 'ASC');

    if (Array.isArray(batchScope)) {
      if (batchScope.length === 0) return [];
      qb.andWhere('b.id IN (:...batchIds)', { batchIds: batchScope });
    }

    return qb.getRawMany<{ id: string; name: string }>();
  }
}
