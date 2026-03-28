import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, In, Repository } from 'typeorm';

import {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardScope,
  PerformanceProfile,
} from '../../database/entities/analytics.entity';
import { StudentElo } from '../../database/entities/battle.entity';
import { Student } from '../../database/entities/student.entity';

import { LeaderboardQueryDto } from './dto/analytics.dto';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @InjectRepository(LeaderboardEntry)
    private readonly leaderboardRepo: Repository<LeaderboardEntry>,
    @InjectRepository(PerformanceProfile)
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StudentElo)
    private readonly eloRepo: Repository<StudentElo>,
    private readonly dataSource: DataSource,
  ) {}

  async getLeaderboard(query: LeaderboardQueryDto, user: any, tenantId: string) {
    const period = query.period || this.getCurrentPeriod();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    if (query.scope !== LeaderboardScope.GLOBAL && !query.scopeValue && query.scope !== LeaderboardScope.BATTLE_XP) {
      throw new BadRequestException('scopeValue is required for this leaderboard scope');
    }

    const rows =
      query.scope === LeaderboardScope.GLOBAL
        ? await this.getStoredGlobalLeaderboard(tenantId, period)
        : await this.computeDynamicLeaderboard(query.scope, query.scopeValue, tenantId);

    const total = rows.length;
    const data = rows.slice(offset, offset + limit);
    const currentStudentRank = await this.getCurrentStudentRank(rows, user, tenantId);

    if (currentStudentRank && !data.some((entry) => entry.studentId === currentStudentRank.studentId)) {
      data.push(currentStudentRank);
    }

    return {
      data,
      currentStudentRank: currentStudentRank
        ? { rank: currentStudentRank.rank, score: currentStudentRank.score }
        : null,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  @Cron('0 2 * * *')
  async recomputeGlobalLeaderboard() {
    const period = this.getCurrentPeriod();
    const profiles = await this.profileRepo.find();
    const elos = await this.eloRepo.find();
    const profileMap = new Map(profiles.map((profile) => [profile.studentId, profile]));
    const eloMap = new Map(elos.map((elo) => [elo.studentId, elo]));

    const students = await this.studentRepo.find({ relations: ['user'] });
    const ranked = students
      .map((student) => {
        const profile = profileMap.get(student.id);
        const elo = eloMap.get(student.id);
        const totalScore = this.extractAverageScore(profile);
        const battleXp = elo?.battleXp || 0;
        const overallAccuracy = profile?.overallAccuracy || 0;
        const score = overallAccuracy * 0.4 + totalScore * 0.4 + battleXp * 0.2;

        return {
          studentId: student.id,
          tenantId: student.tenantId,
          score: Number(score.toFixed(2)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    const monthStart = new Date(`${period}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .delete()
        .from(LeaderboardEntry)
        .where('scope = :scope', { scope: LeaderboardScope.GLOBAL })
        .andWhere('period = :leaderboardPeriod', { leaderboardPeriod: LeaderboardPeriod.MONTHLY })
        .andWhere('computed_at >= :monthStart', { monthStart })
        .andWhere('computed_at < :monthEnd', { monthEnd })
        .execute();

      for (const entry of ranked) {
        await manager.save(
          manager.create(LeaderboardEntry, {
            studentId: entry.studentId,
            scope: LeaderboardScope.GLOBAL,
            scopeValue: period,
            period: LeaderboardPeriod.MONTHLY,
            score: entry.score,
            rank: entry.rank,
            computedAt: new Date(),
          }),
        );
      }
    });

    this.logger.log(`Recomputed global leaderboard for ${period}`);
  }

  private async getStoredGlobalLeaderboard(tenantId: string, period: string) {
    const monthStart = new Date(`${period}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);

    const rows = await this.leaderboardRepo.find({
      where: {
        scope: LeaderboardScope.GLOBAL,
        period: LeaderboardPeriod.MONTHLY,
        student: { tenantId } as any,
      } as any,
      relations: ['student', 'student.user'],
      order: { rank: 'ASC', score: 'DESC' },
    });

    const filtered = rows.filter((entry) => entry.computedAt >= monthStart && entry.computedAt < monthEnd);
    if (!filtered.length) {
      // Compute on-demand but only once — avoid infinite recursion
      await this.recomputeGlobalLeaderboard();
      const recomputed = await this.leaderboardRepo.find({
        where: {
          scope: LeaderboardScope.GLOBAL,
          period: LeaderboardPeriod.MONTHLY,
        } as any,
        relations: ['student', 'student.user'],
        order: { rank: 'ASC', score: 'DESC' },
      });
      const fresh = recomputed.filter((e) => e.computedAt >= monthStart && e.computedAt < monthEnd);
      return fresh.map((entry) => this.serializeLeaderboardEntry(entry));
    }

    return filtered.map((entry) => this.serializeLeaderboardEntry(entry));
  }

  private async computeDynamicLeaderboard(scope: LeaderboardScope, scopeValue: string, tenantId: string) {
    const students = await this.studentRepo.find({ where: { tenantId }, relations: ['user'] });
    const profiles = await this.profileRepo.find({
      where: { studentId: In(students.map((student) => student.id)) },
    });
    const elos = await this.eloRepo.find({
      where: { studentId: In(students.map((student) => student.id)) },
    });

    const profileMap = new Map(profiles.map((profile) => [profile.studentId, profile]));
    const eloMap = new Map(elos.map((elo) => [elo.studentId, elo]));

    const filteredStudents = students.filter((student) => {
      switch (scope) {
        case LeaderboardScope.STATE:
          return student.state === scopeValue;
        case LeaderboardScope.CITY:
          return student.city === scopeValue;
        case LeaderboardScope.SCHOOL:
          return student.coachingName === scopeValue;
        case LeaderboardScope.SUBJECT: {
          const subjectAccuracy = profileMap.get(student.id)?.subjectAccuracy || {};
          return Object.prototype.hasOwnProperty.call(subjectAccuracy, scopeValue);
        }
        case LeaderboardScope.BATTLE_XP:
          return true;
        default:
          return true;
      }
    });

    return filteredStudents
      .map((student) => {
        const profile = profileMap.get(student.id);
        const elo = eloMap.get(student.id);
        const score =
          scope === LeaderboardScope.BATTLE_XP
            ? elo?.battleXp || 0
            : scope === LeaderboardScope.SUBJECT
              ? Number((profile?.subjectAccuracy?.[scopeValue] || 0).toFixed(2))
              : Number((profile?.overallAccuracy || 0).toFixed(2));

        return {
          id: `${scope}-${student.id}`,
          studentId: student.id,
          rank: 0,
          score,
          scope,
          scopeValue: scopeValue || null,
          studentName: student.user?.fullName || null,
          avatar: student.user?.profilePictureUrl || null,
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  private async getCurrentStudentRank(rows: any[], user: any, tenantId: string) {
    if (user.role !== 'student') {
      return null;
    }

    const student = await this.studentRepo.findOne({ where: { userId: user.id, tenantId } });
    if (!student) return null;
    return rows.find((entry) => entry.studentId === student.id) || null;
  }

  private serializeLeaderboardEntry(entry: LeaderboardEntry) {
    return {
      id: entry.id,
      studentId: entry.studentId,
      rank: entry.rank,
      score: entry.score,
      scope: entry.scope,
      scopeValue: entry.scopeValue,
      studentName: entry.student?.user?.fullName || null,
      avatar: entry.student?.user?.profilePictureUrl || null,
    };
  }

  private extractAverageScore(profile?: PerformanceProfile | null) {
    const values = Object.values(profile?.subjectAccuracy || {});
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  }

  private getCurrentPeriod() {
    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${now.getUTCFullYear()}-${month}`;
  }
}
