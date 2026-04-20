import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Lecture, LectureStatus, LectureType } from '../../database/entities/learning.entity';
import { Student } from '../../database/entities/student.entity';
import { UserRole } from '../../database/entities/user.entity';

import { InstituteSettingsService } from './institute-settings.service';

@Injectable()
export class CalendarFeedService {
  constructor(
    private readonly instituteSettings: InstituteSettingsService,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
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
      return [...new Set(enrollments.map((e) => e.batchId))];
    }

    return [];
  }

  async getAggregatedFeed(user: { id: string; role: string }, tenantId: string, year?: number, month?: number) {
    const y = year ?? new Date().getFullYear();
    const m = month ?? new Date().getMonth() + 1;

    const instituteEvents = await this.instituteSettings.getCalendarEvents(tenantId, y, m);

    const batchScope = await this.resolveBatchScope(user, tenantId);
    const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);

    const lectureWhere: any = {
      type: LectureType.LIVE,
      status: In([LectureStatus.SCHEDULED, LectureStatus.LIVE]),
    };

    if (batchScope === null) {
      lectureWhere.tenantId = tenantId;
    } else if (batchScope.length === 0) {
      return { instituteEvents, liveClasses: [] };
    } else if (user.role === UserRole.STUDENT) {
      // Enrolled batches may use institute tenant; scope by batch only.
      lectureWhere.batchId = In(batchScope);
    } else {
      lectureWhere.tenantId = tenantId;
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

    return { instituteEvents, liveClasses };
  }
}
