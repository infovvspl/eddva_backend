import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MockTestType, TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';
import { Student } from '../../database/entities/student.entity';

@Injectable()
export class XpLeaderboardService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
  ) {}

  async getMe(user: any, tenantId: string) {
    const student = await this.getStudentForUser(user.id, tenantId);
    const ranked = await this.getRankedStudents(tenantId);
    const me = ranked.find((row) => row.id === student.id);
    const rank = me?.rank ?? null;
    const cycleXp = Number(student.xpTotal ?? 0);

    return {
      cycleXp,
      rank,
      zone: this.zoneForRank(rank, ranked.length),
      daysUntilReset: this.daysUntilCycleReset(),
      level: Math.max(1, Math.floor(cycleXp / 1000) + 1),
      isUnlocked: cycleXp >= 10,
    };
  }

  async getGroup(user: any, tenantId: string) {
    const student = await this.getStudentForUser(user.id, tenantId);
    const ranked = await this.getRankedStudents(tenantId);
    const current = ranked.find((row) => row.id === student.id);
    const groupSize = 30;
    const start = current ? Math.floor((current.rank - 1) / groupSize) * groupSize : 0;
    const group = ranked.slice(start, start + groupSize);

    return group.map((row) => ({
      studentId: row.id,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      xpEarned: row.xp,
      rank: row.rank - start,
      zone: this.zoneForRank(row.rank - start, group.length),
      isCurrentStudent: row.id === student.id,
    }));
  }

  async getMockRank(user: any, tenantId: string, examType: 'jee' | 'neet') {
    const student = await this.getStudentForUser(user.id, tenantId);
    const rows = await this.sessionRepo
      .createQueryBuilder('session')
      .innerJoin('session.mockTest', 'mockTest')
      .innerJoin('session.student', 'student')
      .where('session.tenantId = :tenantId', { tenantId })
      .andWhere('session.status IN (:...statuses)', {
        statuses: [TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED],
      })
      .andWhere('mockTest.type IN (:...mockTypes)', {
        mockTypes: [MockTestType.FULL_MOCK, MockTestType.SUBJECT_TEST],
      })
      .andWhere(
        `(
          LOWER(COALESCE(mockTest.examMode, '')) LIKE :examLike
          OR LOWER(COALESCE(student.examTarget, '')) LIKE :examLike
        )`,
        { examLike: `%${examType}%` },
      )
      .select('session.studentId', 'studentId')
      .addSelect('COALESCE(SUM(session.correctCount), 0)', 'correct')
      .addSelect('COALESCE(SUM(session.wrongCount), 0)', 'wrong')
      .addSelect('COALESCE(SUM(session.skippedCount), 0)', 'skipped')
      .groupBy('session.studentId')
      .getRawMany<{ studentId: string; correct: string; wrong: string; skipped: string }>();

    const ranked = rows
      .map((row) => {
        const correct = Number(row.correct ?? 0);
        const wrong = Number(row.wrong ?? 0);
        const skipped = Number(row.skipped ?? 0);
        const attempted = correct + wrong + skipped;
        return {
          studentId: row.studentId,
          mockXpTotal: correct * 5,
          accuracy: attempted > 0 ? (correct / attempted) * 100 : 0,
        };
      })
      .sort((a, b) => b.mockXpTotal - a.mockXpTotal || b.accuracy - a.accuracy)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const mine = ranked.find((row) => row.studentId === student.id);
    if (!mine) {
      return { mockXpTotal: 0, rank: null, percentile: null, accuracy: null };
    }

    const total = ranked.length;
    const percentile = total > 1 ? ((total - mine.rank) / (total - 1)) * 100 : 100;

    return {
      mockXpTotal: mine.mockXpTotal,
      rank: mine.rank,
      percentile: Number(percentile.toFixed(1)),
      accuracy: Number(mine.accuracy.toFixed(1)),
    };
  }

  private async getStudentForUser(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) throw new NotFoundException('Student profile not found');
    return student;
  }

  private async getRankedStudents(tenantId: string) {
    const students = await this.studentRepo.find({
      where: { tenantId },
      relations: ['user'],
      order: { xpTotal: 'DESC', createdAt: 'ASC' },
    });

    return students.map((student, index) => ({
      id: student.id,
      fullName: student.user?.fullName || 'Student',
      avatarUrl: student.user?.profilePictureUrl || null,
      xp: Number(student.xpTotal ?? 0),
      rank: index + 1,
    }));
  }

  private zoneForRank(rank: number | null, groupSize: number) {
    if (!rank || groupSize <= 0) return null;
    const promotionCutoff = Math.max(1, Math.ceil(groupSize * 0.2));
    const demotionStart = Math.max(1, groupSize - Math.ceil(groupSize * 0.2) + 1);
    if (rank <= promotionCutoff) return 'promotion';
    if (rank >= demotionStart) return 'demotion';
    return 'safety';
  }

  private daysUntilCycleReset() {
    const cycleMs = 14 * 24 * 60 * 60 * 1000;
    const epoch = Date.UTC(2026, 0, 1);
    const elapsed = Date.now() - epoch;
    const remaining = cycleMs - (elapsed % cycleMs);
    return Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  }
}
