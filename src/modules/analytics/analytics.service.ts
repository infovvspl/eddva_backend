import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import {
  EngagementContext,
  EngagementLog,
  EngagementState,
  PerformanceProfile,
  WeakTopic,
  WeakTopicSeverity,
} from '../../database/entities/analytics.entity';
import { AiStudySession, LectureProgress, PlanItem, PlanItemStatus } from '../../database/entities/learning.entity';
import { Topic } from '../../database/entities/subject.entity';
import { QuestionAttempt, TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';
import { Student } from '../../database/entities/student.entity';
import { UserRole } from '../../database/entities/user.entity';
import { NotificationService } from '../notification/notification.service';

import { LogEngagementDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(PerformanceProfile)
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(EngagementLog)
    private readonly engagementRepo: Repository<EngagementLog>,
    @InjectRepository(TestSession)
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(QuestionAttempt)
    private readonly attemptRepo: Repository<QuestionAttempt>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(PlanItem)
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(AiStudySession)
    private readonly aiStudyRepo: Repository<AiStudySession>,
    @InjectRepository(LectureProgress)
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    private readonly notificationService: NotificationService,
    private readonly dataSource: DataSource,
  ) {}

  async getPerformance(user: any, tenantId: string, studentIdOverride?: string) {
    const student = await this.resolveStudent(user, tenantId, studentIdOverride);
    const profile = await this.profileRepo.findOne({ where: { studentId: student.id } });
    const weakTopics = await this.weakTopicRepo.find({
      where: { studentId: student.id },
      relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
      order: { wrongCount: 'DESC', updatedAt: 'DESC' },
    });

    return {
      performanceProfile: this.serializeProfile(profile, student.id),
      weakTopics: weakTopics.map((topic) => this.serializeWeakTopic(topic)),
    };
  }

  async refreshPerformance(user: any, tenantId: string, studentIdOverride?: string) {
    const student = await this.resolveStudent(user, tenantId, studentIdOverride);
    return this.refreshPerformanceForStudent(student.id, tenantId);
  }

  async refreshPerformanceForStudent(studentId: string, tenantId: string) {
    const sessions = await this.sessionRepo.find({
      where: [
        { studentId, tenantId, status: TestSessionStatus.SUBMITTED },
        { studentId, tenantId, status: TestSessionStatus.AUTO_SUBMITTED },
      ],
    });

    const sessionIds = sessions.map((session) => session.id);
    const attempts = sessionIds.length
      ? await this.attemptRepo.find({
          where: { studentId, tenantId, testSessionId: In(sessionIds) },
        })
      : [];

    const totalCorrect = sessions.reduce((sum, session) => sum + (session.correctCount || 0), 0);
    const totalWrong = sessions.reduce((sum, session) => sum + (session.wrongCount || 0), 0);
    const totalAttempted = totalCorrect + totalWrong;
    const totalScore = sessions.reduce((sum, session) => sum + Number(session.totalScore || 0), 0);
    const averageScore = sessions.length ? totalScore / sessions.length : 0;
    const overallAccuracy = totalAttempted ? (totalCorrect / totalAttempted) * 100 : 0;
    const totalStudents = await this.studentRepo.count({ where: { tenantId } });
    const predictedRank = Math.max(
      1,
      Math.round(totalStudents - (overallAccuracy / 100) * totalStudents),
    );

    const perSubject = await this.computePerSubjectAccuracy(studentId, tenantId);
    const strongSubjectIds = Object.entries(perSubject)
      .filter(([, accuracy]) => Number(accuracy) >= 70)
      .map(([subjectId]) => subjectId);
    const weakSubjectIds = Object.entries(perSubject)
      .filter(([, accuracy]) => Number(accuracy) < 50)
      .map(([subjectId]) => subjectId);

    let profile = await this.profileRepo.findOne({ where: { studentId } });
    if (!profile) {
      profile = this.profileRepo.create({ studentId });
    }

    profile.overallAccuracy = Number(overallAccuracy.toFixed(2));
    profile.subjectAccuracy = {
      ...perSubject,
      __averageScore: Number(averageScore.toFixed(2)),
      __totalTestsTaken: sessions.length,
      __totalQuestionsAttempted: attempts.length,
      __strongSubjectIds: strongSubjectIds,
      __weakSubjectIds: weakSubjectIds,
    };
    profile.predictedRank = predictedRank;
    profile.avgSpeedSeconds = attempts.length
      ? Number(
          (
            attempts.reduce((sum, attempt) => sum + (attempt.timeSpentSeconds || 0), 0) / attempts.length
          ).toFixed(2),
        )
      : 0;
    profile.lastUpdatedAt = new Date();
    await this.profileRepo.save(profile);

    const weakTopics = await this.recomputeWeakTopics(studentId, tenantId);

    return {
      performanceProfile: this.serializeProfile(profile, studentId),
      weakTopics: weakTopics.map((topic) => this.serializeWeakTopic(topic)),
    };
  }

  async logEngagement(dto: LogEngagementDto, userId: string, tenantId: string) {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const log = await this.engagementRepo.save(
      this.engagementRepo.create({
        studentId: student.id,
        state: dto.state,
        context: EngagementContext.LECTURE,
        contextRefId: dto.lectureId,
        signals: { durationSeconds: dto.durationSeconds },
        actionTaken: dto.state === EngagementState.CONFUSED ? 'support_nudge_sent' : null,
      }),
    );

    if (dto.state === EngagementState.CONFUSED) {
      await this.notificationService.send({
        userId,
        tenantId,
        title: "Seems like you're finding this tough. Need help? 💡",
        body: "Seems like you're finding this tough. Need help? 💡",
        channels: ['push', 'in_app'],
        refType: 'engagement_confused',
        refId: dto.lectureId,
      });
    }

    return log;
  }

  async getLectureEngagementSummary(lectureId: string, tenantId: string) {
    const logs = await this.engagementRepo.find({
      where: {
        context: EngagementContext.LECTURE,
        contextRefId: lectureId,
        student: { tenantId } as any,
      } as any,
      relations: ['student'],
      order: { loggedAt: 'ASC' },
    });

    const total = logs.length || 1;
    const counts = {
      engaged: 0,
      bored: 0,
      confused: 0,
      frustrated: 0,
      thriving: 0,
    };

    for (const log of logs) {
      counts[log.state] += 1;
    }

    return {
      engaged: Number(((counts.engaged / total) * 100).toFixed(2)),
      bored: Number(((counts.bored / total) * 100).toFixed(2)),
      confused: Number(((counts.confused / total) * 100).toFixed(2)),
      frustrated: Number(((counts.frustrated / total) * 100).toFixed(2)),
      thriving: Number(((counts.thriving / total) * 100).toFixed(2)),
      timeline: logs.map((log) => ({
        state: log.state,
        detectedAt: log.loggedAt,
        durationSeconds: log.signals?.durationSeconds || 0,
      })),
    };
  }

  private async recomputeWeakTopics(studentId: string, tenantId: string) {
    const rows = await this.dataSource.query(
      `
        SELECT
          q.topic_id AS "topicId",
          COUNT(*)::int AS "attemptCount",
          SUM(CASE WHEN qa.is_correct = false THEN 1 ELSE 0 END)::int AS "wrongCount",
          SUM(CASE WHEN qa.error_type = 'conceptual' THEN 1 ELSE 0 END)::int AS "conceptualErrors",
          SUM(CASE WHEN qa.error_type = 'time' THEN 1 ELSE 0 END)::int AS "timeErrors",
          SUM(CASE WHEN qa.error_type = 'guess' THEN 1 ELSE 0 END)::int AS "sillyErrors",
          MAX(qa.answered_at) AS "lastAttemptedAt",
          AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END)::float AS "accuracy"
        FROM question_attempts qa
        INNER JOIN questions q ON q.id = qa.question_id
        WHERE qa.student_id = $1 AND qa.tenant_id = $2 AND qa.deleted_at IS NULL
        GROUP BY q.topic_id
      `,
      [studentId, tenantId],
    );

    await this.weakTopicRepo.delete({ studentId });

    const saved: WeakTopic[] = [];
    for (const row of rows) {
      const severity = this.mapSeverity(Number(row.wrongCount || 0));
      const weakTopic = this.weakTopicRepo.create({
        studentId,
        topicId: row.topicId,
        severity,
        accuracy: Number(Number(row.accuracy || 0).toFixed(2)),
        wrongCount: Number(row.wrongCount || 0),
        doubtCount: Number(row.conceptualErrors || 0),
        rewindCount: Number(row.timeErrors || 0) + Number(row.sillyErrors || 0),
        lastAttemptedAt: row.lastAttemptedAt ? new Date(row.lastAttemptedAt) : null,
      });
      saved.push(await this.weakTopicRepo.save(weakTopic));
    }

    return saved;
  }

  private async computePerSubjectAccuracy(studentId: string, tenantId: string) {
    const rows = await this.dataSource.query(
      `
        SELECT
          s.name AS "subjectName",
          AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END)::float AS "accuracy"
        FROM question_attempts qa
        INNER JOIN questions q ON q.id = qa.question_id
        INNER JOIN topics t ON t.id = q.topic_id
        INNER JOIN chapters c ON c.id = t.chapter_id
        INNER JOIN subjects s ON s.id = c.subject_id
        WHERE qa.student_id = $1 AND qa.tenant_id = $2 AND qa.deleted_at IS NULL
        GROUP BY s.name
      `,
      [studentId, tenantId],
    );

    return rows.reduce((acc, row) => {
      acc[row.subjectName] = Number(Number(row.accuracy || 0).toFixed(2));
      return acc;
    }, {});
  }

  private async resolveStudent(user: any, tenantId: string, studentIdOverride?: string) {
    if (user.role === UserRole.STUDENT) {
      if (studentIdOverride) {
        const student = await this.studentRepo.findOne({ where: { userId: user.id, tenantId } });
        if (!student || student.id !== studentIdOverride) {
          throw new ForbiddenException('Students can only access their own analytics');
        }
      }

      const student = await this.studentRepo.findOne({ where: { userId: user.id, tenantId } });
      if (!student) throw new NotFoundException('Student not found');
      return student;
    }

    if (!studentIdOverride) {
      throw new BadRequestException('studentId is required for this role');
    }

    const student = await this.studentRepo.findOne({ where: { id: studentIdOverride, tenantId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private mapSeverity(wrongCount: number) {
    if (wrongCount >= 10) return WeakTopicSeverity.CRITICAL;
    if (wrongCount >= 6) return WeakTopicSeverity.HIGH;
    if (wrongCount >= 3) return WeakTopicSeverity.MEDIUM;
    return WeakTopicSeverity.LOW;
  }

  private serializeProfile(profile: PerformanceProfile | null, studentId: string) {
    const subjectAccuracy = profile?.subjectAccuracy || {};
    return {
      studentId,
      overallAccuracy: profile?.overallAccuracy || 0,
      averageScore: Number(subjectAccuracy.__averageScore || 0),
      totalTestsTaken: Number(subjectAccuracy.__totalTestsTaken || 0),
      totalQuestionsAttempted: Number(subjectAccuracy.__totalQuestionsAttempted || 0),
      strongSubjectIds: subjectAccuracy.__strongSubjectIds || [],
      weakSubjectIds: subjectAccuracy.__weakSubjectIds || [],
      estimatedRank: profile?.predictedRank || null,
      lastUpdatedAt: profile?.lastUpdatedAt || null,
      subjectAccuracy: Object.fromEntries(
        Object.entries(subjectAccuracy).filter(([key]) => !key.startsWith('__')),
      ),
    };
  }

  private serializeWeakTopic(topic: WeakTopic) {
    const severityMap = {
      [WeakTopicSeverity.LOW]: 3,
      [WeakTopicSeverity.MEDIUM]: 5,
      [WeakTopicSeverity.HIGH]: 8,
      [WeakTopicSeverity.CRITICAL]: 10,
    };

    return {
      id: topic.id,
      topicId: topic.topicId,
      severity: severityMap[topic.severity],
      errorCount: topic.wrongCount,
      conceptualErrors: topic.doubtCount,
      sillyErrors: Math.max(topic.rewindCount - 0, 0),
      timeErrors: topic.rewindCount,
      lastPracticed: topic.lastAttemptedAt,
      accuracy: topic.accuracy,
      topic: topic.topic,
    };
  }
  async getStudentAdvancedPerformance(user: any, tenantId: string, batchId?: string) {
    const student = await this.resolveStudent(user, tenantId);

    // 1. Score Trend (last 15 sessions)
    const sessions = await this.sessionRepo.find({
      where: { studentId: student.id, tenantId, status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]) },
      order: { createdAt: 'DESC' },
      take: 15,
    });
    const scoreTrend = sessions.reverse().map((s) => ({
      date: s.createdAt.toISOString().split('T')[0],
      score: Number(s.accuracy || 0),
    }));

    // 2. Subject Accuracy
    const subjectAccuracy = await this.computePerSubjectAccuracy(student.id, tenantId);

    // 3. Topic Performance (Detailed)
    const topicPerformance = await this.dataSource.query(
      `
        SELECT
          t.id AS "topicId",
          t.name AS "topicName",
          AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END)::float AS "accuracy",
          COUNT(*)::int AS "attempts",
          AVG(qa.time_spent_seconds)::int AS "timeTaken"
        FROM question_attempts qa
        INNER JOIN questions q ON q.id = qa.question_id
        INNER JOIN topics t ON t.id = q.topic_id
        WHERE qa.student_id = $1 AND qa.tenant_id = $2
        GROUP BY t.id, t.name
        ORDER BY "accuracy" ASC
        LIMIT 10
      `,
      [student.id, tenantId],
    );

    // 4. Mistake Patterns
    const mistakes = await this.dataSource.query(
      `
        SELECT
          error_type AS "type",
          COUNT(*)::int AS "count"
        FROM question_attempts
        WHERE student_id = $1 AND is_correct = false AND error_type IS NOT NULL
        GROUP BY error_type
      `,
      [student.id],
    );

    const errorTypeMap: any = {
      conceptual: 'Conceptual Gap',
      silly: 'Silly Mistake',
      time: 'Time Pressure',
      guess: 'Wild Guess',
    };

    const speedVal = sessions.length 
      ? Math.round(sessions.reduce((acc, s) => acc + (s.avgTimePerQuestion || 0), 0) / sessions.length)
      : 0;

    return {
      scoreTrend,
      subjectAccuracy,
      topicPerformance: topicPerformance.map((t: any) => ({
        ...t,
        score: Math.round(t.accuracy), // Frontend expects score and accuracy
        accuracy: Math.round(t.accuracy),
      })),
      mistakePatterns: mistakes.map((m: any) => ({
        type: errorTypeMap[m.type] || m.type,
        count: m.count,
        description: `Identified ${m.count} ${m.type} errors. Check your logic in these areas.`,
      })),
      speedMetrics: {
        avgTimePerQuestion: speedVal,
        trend: scoreTrend.length > 1 && scoreTrend[scoreTrend.length - 1].score > scoreTrend[0].score ? 'improving' : 'stable',
      },
    };
  }

  async getStudentAdvancedEngagement(user: any, tenantId: string, batchId?: string) {
    const student = await this.resolveStudent(user, tenantId);

    // 1. Daily Active Minutes (last 14 days)
    const activeMinutes = await this.engagementRepo.query(
      `
        SELECT
          DATE(logged_at) AS "date",
          SUM((signals->>'durationSeconds')::int) / 60 AS "minutes"
        FROM engagement_logs
        WHERE student_id = $1 AND logged_at > NOW() - INTERVAL '14 days'
        GROUP BY DATE(logged_at)
        ORDER BY "date" ASC
      `,
      [student.id],
    );

    // 2. Content Preference
    const preferences = await this.engagementRepo.query(
      `
        SELECT
          context AS "type",
          COUNT(*)::int AS "count"
        FROM engagement_logs
        WHERE student_id = $1
        GROUP BY context
      `,
      [student.id],
    );
    const totalEngagements = preferences.reduce((acc: number, p: any) => acc + p.count, 0) || 1;

    // 3. Lecture Activity
    const lectureStats = await this.lectureProgressRepo.find({
      where: { studentId: student.id, tenantId },
    });

    const aiSessions = await this.aiStudyRepo.count({
      where: { studentId: student.id, tenantId },
    });

    return {
      dailyActiveMinutes: activeMinutes.map((m: any) => ({
        date: m.date.toISOString().split('T')[0],
        minutes: Number(m.minutes || 0),
      })),
      contentPreference: preferences.map((p: any) => ({
        type: p.type.charAt(0).toUpperCase() + p.type.slice(1) + 's',
        percentage: Math.round((p.count / totalEngagements) * 100),
      })),
      lectureActivity: {
        totalWatched: lectureStats.length,
        completed: lectureStats.filter((s) => s.isCompleted).length,
        avgWatchPct: Math.round(
          lectureStats.reduce((acc, s) => acc + (s.watchPercentage || 0), 0) / (lectureStats.length || 1),
        ),
      },
      notesGenerated: lectureStats.filter((s) => s.watchPercentage > 50).length, // Proxy for now
      aiTutorSessions: aiSessions,
    };
  }

  async getStudentAdvancedStudyPlan(user: any, tenantId: string, batchId?: string) {
    const student = await this.resolveStudent(user, tenantId);

    const planItems = await this.planItemRepo.find({
      where: { studyPlan: { studentId: student.id } },
      relations: ['studyPlan'],
    });

    const today = new Date().toISOString().split('T')[0];

    return {
      adherence: {
        completed: planItems.filter((i) => i.status === PlanItemStatus.COMPLETED).length,
        skipped: planItems.filter((i) => i.status === PlanItemStatus.SKIPPED).length,
        pending: planItems.filter((i) => i.status === PlanItemStatus.PENDING).length,
      },
      completionRateTrend: [
        { date: 'Last Week', rate: 75 },
        { date: 'This Week', rate: 82 },
      ],
      currentStreak: student.currentStreak || 0,
      overdueItemsCount: planItems.filter(
        (i) => i.status === PlanItemStatus.PENDING && i.scheduledDate < today,
      ).length,
    };
  }

  async getStudentInsights(user: any, tenantId: string, batchId?: string) {
    const student = await this.resolveStudent(user, tenantId);
    const profile = await this.profileRepo.findOne({ where: { studentId: student.id } });
    
    const weakTopicCount = await this.weakTopicRepo.count({ where: { studentId: student.id } });
    
    const overallAccuracy = profile?.overallAccuracy || 0;
    
    // Readiness Score: Weighted average of accuracy and engagement
    // For now, let's just use accuracy as a base and nudge it with consistency
    const consistencyScore = Math.min(100, (student.currentStreak || 0) * 10 + 50); 
    const readinessScore = Math.round(overallAccuracy * 0.8 + consistencyScore * 0.2);

    // Strong Topic Count: Topics with accuracy > 80%
    const strongTopicCount = await this.dataSource.query(
      `
        SELECT COUNT(*) FROM (
          SELECT AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END) as acc
          FROM question_attempts qa
          WHERE qa.student_id = $1
          GROUP BY qa.topic_id
          HAVING AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END) > 80
        ) t
      `,
      [student.id],
    ).then(res => Number(res[0]?.count || 0));

    return {
      status: overallAccuracy > 75 ? "thriving" : overallAccuracy > 50 ? "on_track" : overallAccuracy > 30 ? "warning" : "at_risk",
      performanceTrend: overallAccuracy > 60 ? "improving" : "stable",
      consistencyScore,
      readinessScore,
      weakTopicCount,
      strongTopicCount,
    };
  }
}
