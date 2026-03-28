import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../database/entities/student.entity';
import {
  PerformanceProfile,
  WeakTopic,
  LeaderboardEntry,
  LeaderboardScope,
} from '../../database/entities/analytics.entity';
import { StudyPlan, PlanItem } from '../../database/entities/learning.entity';

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(PerformanceProfile)
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(LeaderboardEntry)
    private readonly leaderboardRepo: Repository<LeaderboardEntry>,
    @InjectRepository(StudyPlan)
    private readonly planRepo: Repository<StudyPlan>,
    @InjectRepository(PlanItem)
    private readonly planItemRepo: Repository<PlanItem>,
  ) {}

  async getDashboard(userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({
      where: { userId, tenantId },
      relations: ['user'],
    });
    if (!student) throw new NotFoundException('Student not found');

    const [profile, weakTopics, todayPlan, globalRank] = await Promise.all([
      this.profileRepo.findOne({ where: { studentId: student.id } }),
      this.weakTopicRepo.find({
        where: { studentId: student.id },
        relations: ['topic'],
        order: { severity: 'DESC' },
        take: 5,
      }),
      this.getTodayPlanItems(student.id),
      this.leaderboardRepo.findOne({
        where: { studentId: student.id, scope: LeaderboardScope.GLOBAL },
      }),
    ]);

    return {
      student,
      predictedRank: profile?.predictedRank,
      overallAccuracy: profile?.overallAccuracy,
      currentStreak: student.currentStreak,
      xpTotal: student.xpTotal,
      weakTopics,
      todayPlan,
      globalRank: globalRank?.rank,
      globalPercentile: globalRank?.percentile,
    };
  }

  async getTodayPlanItems(studentId: string) {
    const today = new Date().toISOString().split('T')[0];
    const plan = await this.planRepo.findOne({ where: { studentId } });
    if (!plan) return [];
    return this.planItemRepo.find({
      where: { studyPlanId: plan.id, scheduledDate: today },
      order: { sortOrder: 'ASC' },
    });
  }

  async getWeakTopics(studentId: string) {
    return this.weakTopicRepo.find({
      where: { studentId },
      relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
      order: { severity: 'DESC' },
    });
  }

  async updateStreak(studentId: string) {
    const student = await this.studentRepo.findOne({ where: { id: studentId } });
    if (!student) return;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    if (student.lastActiveDate === today) return;

    if (student.lastActiveDate === yesterday) {
      student.currentStreak += 1;
      if (student.currentStreak > student.longestStreak) {
        student.longestStreak = student.currentStreak;
      }
    } else {
      student.currentStreak = 1;
    }
    student.lastActiveDate = today;
    await this.studentRepo.save(student);
  }

  async awardXp(studentId: string, amount: number) {
    await this.studentRepo.increment({ id: studentId }, 'xpTotal', amount);
  }
}
