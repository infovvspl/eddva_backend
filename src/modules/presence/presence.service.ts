import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, MoreThan } from 'typeorm';
import { LiveSession, LiveSessionStatus } from '../../database/entities/live-class.entity';
import { Student } from '../../database/entities/student.entity';
import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

const ONLINE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface PresenceRecord {
  role: string;
  tenantId: string;
  ts: number;
}

@Injectable()
export class PresenceService {
  private readonly map = new Map<string, PresenceRecord>();

  constructor(
    @InjectRepository(LiveSession, 'coaching')
    private readonly liveSessionRepo: Repository<LiveSession>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
  ) {}

  async beat(userId: string, role: string, tenantId: string): Promise<void> {
    const effectiveTenantId = await this.resolveTenantForPresence(userId, role, tenantId);
    this.map.set(userId, { role, tenantId: effectiveTenantId, ts: Date.now() });
  }

  async getAdminStats(tenantId: string): Promise<{
    studentsOnline: number;
    teachersOnline: number;
    liveClassesRunning: number;
  }> {
    const now = Date.now();
    let studentsOnline = 0;
    let teachersOnline = 0;

    for (const [, v] of this.map) {
      if (v.tenantId !== tenantId || now - v.ts > ONLINE_TTL_MS) continue;
      if (v.role === 'student') studentsOnline++;
      else if (v.role === 'teacher') teachersOnline++;
    }

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const liveClassesRunning = await this.liveSessionRepo.count({
      where: {
        tenantId,
        status: LiveSessionStatus.LIVE,
        startedAt: MoreThan(twelveHoursAgo),
      },
    });

    return { studentsOnline, teachersOnline, liveClassesRunning };
  }

  getTeacherStats(tenantId: string): { studentsOnline: number } {
    const now = Date.now();
    let studentsOnline = 0;

    for (const [, v] of this.map) {
      if (v.tenantId !== tenantId || now - v.ts > ONLINE_TTL_MS) continue;
      if (v.role === 'student') studentsOnline++;
    }

    return { studentsOnline };
  }

  async getOnlineStudentIdsByTenant(tenantId: string): Promise<string[]> {
    const now = Date.now();
    const onlineStudentUserIds: string[] = [];

    for (const [userId, v] of this.map) {
      if (v.role !== 'student') continue;
      if (v.tenantId !== tenantId || now - v.ts > ONLINE_TTL_MS) continue;
      onlineStudentUserIds.push(userId);
    }

    if (!onlineStudentUserIds.length) return [];

    const students = await this.studentRepo.find({
      where: { userId: In(onlineStudentUserIds) },
      select: ['id'],
    });

    return students.map((s) => s.id);
  }

  private async resolveTenantForPresence(userId: string, role: string, tenantId: string): Promise<string> {
    if (role !== 'student') return tenantId;

    const student = await this.studentRepo.findOne({
      where: { userId },
      select: ['id', 'tenantId'],
    });
    if (!student) return tenantId;

    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    });

    return enrollment?.batch?.tenantId ?? student.tenantId ?? tenantId;
  }
}
