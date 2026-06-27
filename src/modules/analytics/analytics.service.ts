import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
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
    @InjectRepository(PerformanceProfile, 'coaching')
    private readonly profileRepo: Repository<PerformanceProfile>,
    @InjectRepository(WeakTopic, 'coaching')
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(EngagementLog, 'coaching')
    private readonly engagementRepo: Repository<EngagementLog>,
    @InjectRepository(TestSession, 'coaching')
    private readonly sessionRepo: Repository<TestSession>,
    @InjectRepository(QuestionAttempt, 'coaching')
    private readonly attemptRepo: Repository<QuestionAttempt>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(PlanItem, 'coaching')
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(AiStudySession, 'coaching')
    private readonly aiStudyRepo: Repository<AiStudySession>,
    @InjectRepository(LectureProgress, 'coaching')
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(Topic, 'coaching')
    private readonly topicRepo: Repository<Topic>,
    private readonly notificationService: NotificationService,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
  ) { }

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
        title: "Seems like you're finding this tough. Need help? ðŸ’¡",
        body: "Seems like you're finding this tough. Need help? ðŸ’¡",
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
    const sessions = await this.dataSource.query(
      `SELECT id, correct_count, wrong_count, skipped_count, accuracy,
              started_at, submitted_at, created_at
       FROM test_sessions
       WHERE student_id = $1
         AND tenant_id = $2
         AND status IN ('submitted', 'auto_submitted')
       ORDER BY created_at DESC
       LIMIT 15`,
      [student.id, tenantId]
    );
    const scoreTrend = sessions.reverse().map((s: any) => {
      const correct = s.correct_count || 0;
      const wrong = s.wrong_count || 0;
      const skipped = s.skipped_count || 0;
      const attempted = correct + wrong + skipped;
      const score = attempted > 0 ? Math.round(correct / attempted * 100) : 0;
      return {
        date: new Date(s.created_at).toISOString().split('T')[0],
        score,
      };
    });

    // 2. Subject Accuracy
    const subjectAccuracy = await this.computePerSubjectAccuracy(student.id, tenantId);

    // 3. Topic Performance (Detailed)
    const topicPerformance = await this.dataSource.query(
      `SELECT
         t.id AS "topicId",
         t.name AS "topicName",
         ROUND(
           CASE WHEN COUNT(qa.id) > 0
           THEN COUNT(qa.id) FILTER (WHERE qa.is_correct = true)::float
                / COUNT(qa.id) * 100
           ELSE 0 END
         )::int AS "accuracy",
         COUNT(qa.id) FILTER (WHERE qa.is_correct = false)::int AS "errorCount",
         COUNT(qa.id) FILTER (WHERE qa.error_type = 'time')::int AS "timeErrors"
       FROM topics t
       INNER JOIN questions q ON q.topic_id = t.id
         AND q.deleted_at IS NULL
       INNER JOIN question_attempts qa ON qa.question_id = q.id
         AND qa.student_id = $1
         AND qa.tenant_id = $2
         AND qa.deleted_at IS NULL
       WHERE t.tenant_id = $2
         AND t.deleted_at IS NULL
       GROUP BY t.id, t.name
       ORDER BY "accuracy" ASC
       LIMIT 10`,
      [student.id, tenantId]
    );

    // 4. Mistake Patterns
    const mistakes = await this.dataSource.query(
      `SELECT
         error_type AS "type",
         COUNT(*)::int AS "count"
       FROM question_attempts
       WHERE student_id = $1
         AND tenant_id = $2
         AND error_type IS NOT NULL
         AND deleted_at IS NULL
       GROUP BY error_type
       ORDER BY count DESC`,
      [student.id, tenantId]
    );

    const errorTypeMap: any = {
      conceptual: 'Conceptual Gap',
      silly: 'Silly Mistake',
      time: 'Time Pressure',
      guess: 'Wild Guess',
      skip: 'Skipped Questions',
      careless: 'Careless Error',
    };

    const speedVal = sessions.length
      ? Math.round(
        sessions.reduce((acc, s) => {
          const durationSec = s.submittedAt && s.startedAt
            ? (s.submittedAt.getTime() - s.startedAt.getTime()) / 1000
            : 0;
          const attempts = (s.correctCount || 0) + (s.wrongCount || 0) + (s.skippedCount || 0);
          return acc + (attempts > 0 ? durationSec / attempts : 0);
        }, 0) / sessions.length,
      )
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

    // 1. Daily Active Minutes (last 14 days) — aggregate ALL activity types
    const activeMinutes = await this.dataSource.query(
      `
        WITH daily AS (
          -- Engagement logs (lecture watch events)
          SELECT DATE(logged_at) AS d,
                 COALESCE(SUM((signals->>'durationSeconds')::int), 0) / 60 AS mins
          FROM engagement_logs
          WHERE student_id = $1 AND logged_at > NOW() - INTERVAL '14 days' AND deleted_at IS NULL
          GROUP BY DATE(logged_at)

          UNION ALL

          -- Test sessions (duration = submitted - started)
          SELECT DATE(started_at) AS d,
                 COALESCE(SUM(EXTRACT(EPOCH FROM (submitted_at - started_at))::int), 0) / 60 AS mins
          FROM test_sessions
          WHERE student_id = $1 AND tenant_id = $2
            AND status IN ('submitted', 'auto_submitted')
            AND started_at > NOW() - INTERVAL '14 days'
            AND submitted_at IS NOT NULL AND deleted_at IS NULL
          GROUP BY DATE(started_at)

          UNION ALL

          -- AI study sessions
          SELECT DATE(created_at) AS d,
                 COALESCE(SUM(time_spent_seconds), 0) / 60 AS mins
          FROM ai_study_sessions
          WHERE student_id = $1 AND tenant_id = $2
            AND created_at > NOW() - INTERVAL '14 days' AND deleted_at IS NULL
          GROUP BY DATE(created_at)
        )
        SELECT d AS "date", SUM(mins)::int AS "minutes"
        FROM daily
        GROUP BY d
        ORDER BY d ASC
      `,
      [student.id, tenantId],
    );

    // 2. Content Preference — count real activity types across all tables
    const lectureCount = await this.lectureProgressRepo.count({
      where: { studentId: student.id, tenantId },
    });
    const assessmentCount = await this.sessionRepo.count({
      where: { studentId: student.id, tenantId, status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]) },
    });
    const aiSessionCount = await this.aiStudyRepo.count({
      where: { studentId: student.id, tenantId },
    });

    const totalActivities = (lectureCount + assessmentCount + aiSessionCount) || 1;
    const contentPreference = [
      { type: 'Recorded Lectures', percentage: Math.round((lectureCount / totalActivities) * 100) },
      { type: 'Assessments', percentage: Math.round((assessmentCount / totalActivities) * 100) },
      { type: 'AI Tutor', percentage: Math.round((aiSessionCount / totalActivities) * 100) },
    ].filter(p => p.percentage > 0);

    // 3. Lecture Activity
    const lectureStats = await this.lectureProgressRepo.find({
      where: { studentId: student.id, tenantId },
    });

    // 4. Real notes count — AI study sessions with generated lesson content
    const notesGenerated = await this.aiStudyRepo.count({
      where: { studentId: student.id, tenantId, isCompleted: true },
    });

    return {
      dailyActiveMinutes: activeMinutes.map((m: any) => ({
        date: (m.date instanceof Date ? m.date.toISOString() : String(m.date)).split('T')[0],
        minutes: Number(m.minutes || 0),
      })),
      contentPreference,
      lectureActivity: {
        totalWatched: lectureStats.length,
        completed: lectureStats.filter((s) => s.isCompleted).length,
        avgWatchPct: Math.round(
          lectureStats.reduce((acc, s) => acc + (s.watchPercentage || 0), 0) / (lectureStats.length || 1),
        ),
      },
      notesGenerated,
      aiTutorSessions: aiSessionCount,
    };
  }

  async getStudentAdvancedStudyPlan(user: any, tenantId: string, batchId?: string) {
    const student = await this.resolveStudent(user, tenantId);

    const planItems = await this.planItemRepo.find({
      where: { studyPlan: { studentId: student.id } },
      relations: ['studyPlan'],
    });

    const today = new Date().toISOString().split('T')[0];

    // Compute real weekly completion rate trend (last 4 weeks)
    const completionRateTrend: { date: string; rate: number }[] = [];
    const now = new Date();
    for (let w = 3; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (w + 1) * 7);
      const weekEnd = new Date(now);
      weekEnd.setDate(now.getDate() - w * 7);
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      const weekItems = planItems.filter(
        (i) => i.scheduledDate >= weekStartStr && i.scheduledDate < weekEndStr,
      );
      const completedInWeek = weekItems.filter((i) => i.status === PlanItemStatus.COMPLETED).length;
      const rate = weekItems.length > 0 ? Math.round((completedInWeek / weekItems.length) * 100) : 0;
      const label = w === 0 ? 'This Week' : w === 1 ? 'Last Week' : `${w + 1} Weeks Ago`;
      completionRateTrend.push({ date: label, rate });
    }

    return {
      adherence: {
        completed: planItems.filter((i) => i.status === PlanItemStatus.COMPLETED).length,
        skipped: planItems.filter((i) => i.status === PlanItemStatus.SKIPPED).length,
        pending: planItems.filter((i) => i.status === PlanItemStatus.PENDING).length,
      },
      completionRateTrend,
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
    const consistencyScore = Math.min(100, (student.currentStreak || 0) * 10 + 50);
    const readinessScore = Math.round(overallAccuracy * 0.8 + consistencyScore * 0.2);

    // Performance Trend: compare average score of last 5 sessions vs previous 5
    const recentSessions = await this.sessionRepo.find({
      where: { studentId: student.id, tenantId, status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]) },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    let performanceTrend: 'improving' | 'declining' | 'stable' = 'stable';
    if (recentSessions.length >= 4) {
      const half = Math.floor(recentSessions.length / 2);
      const recentHalf = recentSessions.slice(0, half);
      const olderHalf = recentSessions.slice(half);
      const avgRecent = recentHalf.reduce((acc, s) => {
        const attempted = (s.correctCount || 0) + (s.wrongCount || 0) + (s.skippedCount || 0);
        return acc + (attempted > 0 ? ((s.correctCount || 0) / attempted) * 100 : 0);
      }, 0) / recentHalf.length;
      const avgOlder = olderHalf.reduce((acc, s) => {
        const attempted = (s.correctCount || 0) + (s.wrongCount || 0) + (s.skippedCount || 0);
        return acc + (attempted > 0 ? ((s.correctCount || 0) / attempted) * 100 : 0);
      }, 0) / olderHalf.length;
      const delta = avgRecent - avgOlder;
      performanceTrend = delta > 5 ? 'improving' : delta < -5 ? 'declining' : 'stable';
    }

    // Strong Topic Count: Topics with accuracy > 80%
    const strongTopicCount = await this.dataSource.query(
      `
        SELECT COUNT(*)::int AS "count" FROM (
          SELECT AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END) as acc
          FROM question_attempts qa
          INNER JOIN questions q ON q.id = qa.question_id
          WHERE qa.student_id = $1 AND qa.tenant_id = $2 AND qa.deleted_at IS NULL
          GROUP BY q.topic_id
          HAVING AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END) > 80
        ) t
      `,
      [student.id, tenantId],
    ).then(res => Number(res[0]?.count || 0));

    return {
      status: overallAccuracy > 75 ? "thriving" : overallAccuracy > 50 ? "on_track" : overallAccuracy > 30 ? "warning" : "at_risk",
      performanceTrend,
      consistencyScore,
      readinessScore,
      weakTopicCount,
      strongTopicCount,
    };
  }
}
