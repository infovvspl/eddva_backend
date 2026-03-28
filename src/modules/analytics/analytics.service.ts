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
}
