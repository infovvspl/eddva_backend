import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Batch, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';
import { Doubt, DoubtStatus, Lecture, LectureProgress } from '../../database/entities/learning.entity';
import { TestSession, TestSessionStatus } from '../../database/entities/assessment.entity';
import { Student } from '../../database/entities/student.entity';
import { WeakTopic, PerformanceProfile } from '../../database/entities/analytics.entity';
import { Topic, Subject, Chapter } from '../../database/entities/subject.entity';

import {
  TeacherAnalyticsQueryDto,
  ClassPerformanceQueryDto,
  ExportQueryDto,
} from './dto/teacher-analytics.dto';

@Injectable()
export class TeacherAnalyticsService {
  constructor(
    @InjectRepository(Batch) private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(TestSession) private readonly testSessionRepo: Repository<TestSession>,
    @InjectRepository(LectureProgress) private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(Lecture) private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(Doubt) private readonly doubtRepo: Repository<Doubt>,
    @InjectRepository(WeakTopic) private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(PerformanceProfile) private readonly perfProfileRepo: Repository<PerformanceProfile>,
    @InjectRepository(Topic) private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Chapter) private readonly chapterRepo: Repository<Chapter>,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getTeacherBatches(teacherId: string, tenantId: string, batchId?: string) {
    const where: any = { tenantId, teacherId };
    if (batchId) where.id = batchId;
    return this.batchRepo.find({ where });
  }

  private async getTeacherStudentIds(teacherId: string, tenantId: string, batchId?: string) {
    const batches = await this.getTeacherBatches(teacherId, tenantId, batchId);
    if (!batches.length) return { batches, studentIds: [] };

    const enrollments = await this.enrollmentRepo.find({
      where: {
        tenantId,
        batchId: In(batches.map((b) => b.id)),
        status: EnrollmentStatus.ACTIVE,
      },
    });

    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    return { batches, studentIds };
  }

  // ─── 1. Overview ──────────────────────────────────────────────────────────

  async getOverview(teacherId: string, tenantId: string, query: TeacherAnalyticsQueryDto) {
    const { batches, studentIds } = await this.getTeacherStudentIds(teacherId, tenantId, query.batchId);

    const totalStudents = studentIds.length;
    const totalBatches = batches.length;

    // Quiz stats
    const testSessions = studentIds.length
      ? await this.testSessionRepo.find({
          where: {
            tenantId,
            studentId: In(studentIds),
            status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]),
          },
        })
      : [];

    const scores = testSessions.filter((s) => s.totalScore != null).map((s) => s.totalScore);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // Lecture completion stats
    const lectureProgress = studentIds.length
      ? await this.lectureProgressRepo.find({
          where: { tenantId, studentId: In(studentIds) },
        })
      : [];

    const avgWatchPct =
      lectureProgress.length
        ? lectureProgress.reduce((a, b) => a + b.watchPercentage, 0) / lectureProgress.length
        : 0;

    const completedLectures = lectureProgress.filter((lp) => lp.isCompleted).length;

    // Doubt stats
    const doubts = studentIds.length
      ? await this.doubtRepo.find({
          where: { tenantId, studentId: In(studentIds) },
        })
      : [];

    const openDoubts = doubts.filter(
      (d) => d.status === DoubtStatus.ESCALATED || d.status === DoubtStatus.OPEN,
    ).length;
    const resolvedDoubts = doubts.filter((d) => d.status === DoubtStatus.TEACHER_RESOLVED).length;

    return {
      totalBatches,
      totalStudents,
      quizzes: {
        totalAttempts: testSessions.length,
        avgScore: Math.round(avgScore * 10) / 10,
      },
      lectures: {
        avgWatchPercentage: Math.round(avgWatchPct * 10) / 10,
        completedCount: completedLectures,
      },
      doubts: {
        total: doubts.length,
        open: openDoubts,
        resolved: resolvedDoubts,
        resolutionRate: doubts.length ? Math.round((resolvedDoubts / doubts.length) * 100) : 0,
      },
      batches: batches.map((b) => ({ id: b.id, name: b.name, status: b.status })),
    };
  }

  // ─── 2. Class Performance ─────────────────────────────────────────────────

  async getClassPerformance(teacherId: string, tenantId: string, query: ClassPerformanceQueryDto) {
    const { studentIds } = await this.getTeacherStudentIds(teacherId, tenantId, query.batchId);
    if (!studentIds.length) {
      return { data: [], meta: { total: 0, page: 1, limit: query.limit || 30, totalPages: 0 } };
    }

    const page = query.page || 1;
    const limit = query.limit || 30;
    const skip = (page - 1) * limit;

    const students = await this.studentRepo.find({
      where: { id: In(studentIds), tenantId },
      relations: ['user'],
    });

    // batch test sessions per student
    const testSessions = await this.testSessionRepo.find({
      where: {
        tenantId,
        studentId: In(studentIds),
        status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]),
      },
    });

    // lecture progress per student
    const lectureProgresses = await this.lectureProgressRepo.find({
      where: { tenantId, studentId: In(studentIds) },
    });

    // doubts per student
    const doubts = await this.doubtRepo.find({
      where: { tenantId, studentId: In(studentIds) },
    });

    // performance profiles for all students
    const perfProfiles = await this.perfProfileRepo.find({
      where: { studentId: In(studentIds) },
    });

    const rows = students.map((student) => {
      const sessions = testSessions.filter((s) => s.studentId === student.id);
      const scores = sessions.filter((s) => s.totalScore != null).map((s) => s.totalScore);
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

      const correct = sessions.reduce((a, b) => a + (b.correctCount || 0), 0);
      const total = sessions.reduce((a, b) => a + (b.correctCount || 0) + (b.wrongCount || 0), 0);
      const accuracy = total ? (correct / total) * 100 : 0;

      const progresses = lectureProgresses.filter((lp) => lp.studentId === student.id);
      const avgWatch =
        progresses.length ? progresses.reduce((a, b) => a + b.watchPercentage, 0) / progresses.length : 0;

      const studentDoubts = doubts.filter((d) => d.studentId === student.id);

      // Aggregate error breakdown from test sessions
      const errorBreakdown = sessions.reduce(
        (acc, s) => {
          const eb = (s as any).errorBreakdown as { conceptual?: number; silly?: number; time?: number; guess?: number; skip?: number } | null;
          if (eb) {
            acc.conceptual += eb.conceptual || 0;
            acc.silly += eb.silly || 0;
            acc.time += eb.time || 0;
            acc.guess += eb.guess || 0;
            acc.skip += eb.skip || 0;
          }
          return acc;
        },
        { conceptual: 0, silly: 0, time: 0, guess: 0, skip: 0 },
      );

      // Get subject accuracy from performance profile
      const profile = perfProfiles.find((p) => p.studentId === student.id);
      const accuracyPerSubject: Record<string, number> = (profile as any)?.subjectAccuracy || {};

      return {
        studentId: student.id,
        name: student.user?.fullName || 'Unknown',
        avatar: student.user?.profilePictureUrl || null,
        quizzesTaken: sessions.length,
        avgScore: Math.round(avgScore * 10) / 10,
        accuracy: Math.round(accuracy * 10) / 10,
        avgWatchPercentage: Math.round(avgWatch * 10) / 10,
        doubtCount: studentDoubts.length,
        openDoubts: studentDoubts.filter(
          (d) => d.status === DoubtStatus.ESCALATED || d.status === DoubtStatus.OPEN,
        ).length,
        accuracyPerSubject,
        errorBreakdown,
      };
    });

    const sortBy = query.sortBy || 'avgScore';
    const order = query.order || 'desc';
    const sorted = rows.sort((a, b) => {
      const aVal = (a as any)[sortBy] ?? 0;
      const bVal = (b as any)[sortBy] ?? 0;
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Assign ranks based on avgScore descending
    const rankedByScore = [...rows].sort((a, b) => b.avgScore - a.avgScore);
    const rankMap = new Map<string, number>();
    rankedByScore.forEach((s, idx) => rankMap.set(s.studentId, idx + 1));

    const paginated = sorted.slice(skip, skip + limit).map((s) => ({
      ...s,
      rank: rankMap.get(s.studentId) ?? 0,
    }));

    return {
      data: paginated,
      meta: { total: rows.length, page, limit, totalPages: Math.ceil(rows.length / limit) },
    };
  }

  // ─── 3. Topic Coverage ────────────────────────────────────────────────────

  async getTopicCoverage(teacherId: string, tenantId: string, query: TeacherAnalyticsQueryDto) {
    const { batches, studentIds } = await this.getTeacherStudentIds(teacherId, tenantId, query.batchId);
    if (!studentIds.length) return [];

    const totalStudents = studentIds.length;

    // Get all lectures for this teacher's batches
    const batchIds = batches.map((b) => b.id);
    const lectures = batchIds.length
      ? await this.lectureRepo.find({
          where: { teacherId, batchId: In(batchIds) },
        })
      : [];

    // Set of topic IDs that have at least one lecture (taught topics)
    const taughtTopicIds = new Set<string>(
      lectures.map((l) => (l as any).topicId).filter(Boolean),
    );

    // Get weak topics for all students
    const weakTopics = await this.weakTopicRepo.find({
      where: { studentId: In(studentIds) },
      relations: ['topic', 'topic.chapter', 'topic.chapter.subject'],
    });

    // Fetch Topic entities for taught topics (to get gatePassPercentage, estimatedStudyMinutes)
    const taughtTopicIdsArr = Array.from(taughtTopicIds);
    const topicEntities = taughtTopicIdsArr.length
      ? await this.topicRepo.find({ where: { id: In(taughtTopicIdsArr) } })
      : [];
    const topicEntityMap = new Map(topicEntities.map((t) => [t.id, t]));

    // Also get all topic IDs from weak topics
    const weakTopicIds = [...new Set(weakTopics.map((wt) => wt.topicId).filter(Boolean))];
    const extraTopicIds = weakTopicIds.filter((id) => !topicEntityMap.has(id));
    if (extraTopicIds.length) {
      const extraTopics = await this.topicRepo.find({ where: { id: In(extraTopicIds) } });
      for (const t of extraTopics) topicEntityMap.set(t.id, t);
    }

    // Group weak topics by topicId
    const topicMap = new Map<
      string,
      {
        topicId: string;
        topicName: string;
        chapterName: string;
        subjectName: string;
        severity: string;
        avgAccuracy: number;
        affectedStudents: Set<string>;
        totalWrong: number;
        totalDoubt: number;
        weakTopicEntries: { studentId: string; accuracy: number }[];
      }
    >();

    for (const wt of weakTopics) {
      if (!wt.topicId) continue;
      const key = wt.topicId;
      if (!topicMap.has(key)) {
        topicMap.set(key, {
          topicId: wt.topicId,
          topicName: wt.topic?.name || 'Unknown',
          chapterName: wt.topic?.chapter?.name || 'Unknown',
          subjectName: (wt.topic?.chapter as any)?.subject?.name || 'Unknown',
          severity: wt.severity,
          avgAccuracy: 0,
          affectedStudents: new Set(),
          totalWrong: 0,
          totalDoubt: 0,
          weakTopicEntries: [],
        });
      }
      const entry = topicMap.get(key)!;
      entry.affectedStudents.add(wt.studentId);
      entry.totalWrong += wt.wrongCount || 0;
      entry.totalDoubt += wt.doubtCount || 0;
      entry.avgAccuracy += wt.accuracy || 0;
      entry.weakTopicEntries.push({ studentId: wt.studentId, accuracy: wt.accuracy || 0 });
    }

    // Lecture count per topic
    const lectureCountPerTopic = new Map<string, number>();
    for (const l of lectures) {
      const tid = (l as any).topicId;
      if (tid) lectureCountPerTopic.set(tid, (lectureCountPerTopic.get(tid) || 0) + 1);
    }

    // Build result items
    const taughtItems: any[] = [];
    const untaughtItems: any[] = [];

    const processedTopicIds = new Set<string>();

    // Process topics from weak topics list
    for (const [topicId, t] of topicMap.entries()) {
      processedTopicIds.add(topicId);
      const isTaught = taughtTopicIds.has(topicId);
      const topicEntity = topicEntityMap.get(topicId);
      const gatePassPercentage = (topicEntity as any)?.gatePassPercentage ?? 70;
      const estimatedStudyMinutes = (topicEntity as any)?.estimatedStudyMinutes ?? 0;

      // Count students who passed the gate
      // Students who are not in affectedStudents, or whose accuracy >= gatePassPercentage
      const studentsInWeak = new Set(t.weakTopicEntries.map((e) => e.studentId));
      const studentsPassed = t.weakTopicEntries.filter(
        (e) => e.accuracy >= gatePassPercentage,
      ).length + (totalStudents - studentsInWeak.size);
      const studentsPassedGate = Math.max(0, studentsPassed);
      const gatePassRate = totalStudents ? Math.round((studentsPassedGate / totalStudents) * 100) : 100;

      const item = {
        topicId,
        topicName: t.topicName,
        chapterName: t.chapterName,
        subjectName: t.subjectName,
        severity: t.severity,
        affectedStudents: t.affectedStudents.size,
        affectedPercentage: totalStudents
          ? Math.round((t.affectedStudents.size / totalStudents) * 100)
          : 0,
        avgAccuracy: t.affectedStudents.size
          ? Math.round((t.avgAccuracy / t.affectedStudents.size) * 10) / 10
          : 0,
        totalWrong: t.totalWrong,
        totalDoubt: t.totalDoubt,
        taught: isTaught,
        lectureCount: lectureCountPerTopic.get(topicId) || 0,
        gatePassPercentage,
        estimatedStudyMinutes,
        studentsPassedGate,
        gatePassRate,
      };

      if (isTaught) {
        taughtItems.push(item);
      } else {
        untaughtItems.push(item);
      }
    }

    // Add taught topics that have no weak topic entries
    for (const topicId of taughtTopicIds) {
      if (processedTopicIds.has(topicId)) continue;
      const topicEntity = topicEntityMap.get(topicId);
      if (!topicEntity) continue;
      const gatePassPercentage = (topicEntity as any)?.gatePassPercentage ?? 70;
      const estimatedStudyMinutes = (topicEntity as any)?.estimatedStudyMinutes ?? 0;
      taughtItems.push({
        topicId,
        topicName: topicEntity.name,
        chapterName: '',
        subjectName: '',
        severity: 'low',
        affectedStudents: 0,
        affectedPercentage: 0,
        avgAccuracy: 100,
        totalWrong: 0,
        totalDoubt: 0,
        taught: true,
        lectureCount: lectureCountPerTopic.get(topicId) || 0,
        gatePassPercentage,
        estimatedStudyMinutes,
        studentsPassedGate: totalStudents,
        gatePassRate: 100,
      });
    }

    taughtItems.sort((a, b) => b.affectedStudents - a.affectedStudents);
    untaughtItems.sort((a, b) => b.affectedStudents - a.affectedStudents);

    return [...taughtItems, ...untaughtItems].slice(0, 50);
  }

  // ─── 4. Engagement Heatmap ────────────────────────────────────────────────

  async getEngagementHeatmap(teacherId: string, tenantId: string, lectureId: string) {
    const lecture = await this.lectureRepo.findOne({
      where: { id: lectureId, tenantId, teacherId },
    });
    if (!lecture) return { lecture: null, segments: [], confusionPeaks: [] };

    const progresses = await this.lectureProgressRepo.find({
      where: { lectureId, tenantId },
    });

    const duration = lecture.videoDurationSeconds || 0;
    const SEGMENT_COUNT = 20;
    const segmentSize = duration / SEGMENT_COUNT;

    // Build rewind heatmap per segment
    const segments = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
      segmentIndex: i,
      startSeconds: Math.round(i * segmentSize),
      endSeconds: Math.round((i + 1) * segmentSize),
      rewindCount: 0,
      confusionCount: 0,
      watchers: 0,
    }));

    for (const prog of progresses) {
      if (prog.confusionFlags) {
        for (const flag of prog.confusionFlags) {
          const idx = Math.min(Math.floor(flag.timestampSeconds / segmentSize), SEGMENT_COUNT - 1);
          if (segments[idx]) {
            segments[idx].rewindCount += flag.rewindCount || 1;
            segments[idx].confusionCount += 1;
          }
        }
      }

      // Count watchers for each segment based on watch percentage
      const watchedUpTo = (prog.watchPercentage / 100) * duration;
      for (const seg of segments) {
        if (watchedUpTo >= seg.startSeconds) seg.watchers++;
      }
    }

    const confusionPeaks = segments
      .filter((s) => s.confusionCount > 0)
      .sort((a, b) => b.confusionCount - a.confusionCount)
      .slice(0, 5);

    return {
      lecture: {
        id: lecture.id,
        title: lecture.title,
        durationSeconds: duration,
        totalViewers: progresses.length,
        avgWatchPercentage:
          progresses.length
            ? progresses.reduce((a, b) => a + b.watchPercentage, 0) / progresses.length
            : 0,
      },
      segments,
      confusionPeaks,
    };
  }

  // ─── 5. Doubt Analytics ───────────────────────────────────────────────────

  async getDoubtAnalytics(teacherId: string, tenantId: string, query: TeacherAnalyticsQueryDto) {
    const { studentIds } = await this.getTeacherStudentIds(teacherId, tenantId, query.batchId);
    if (!studentIds.length) {
      return { summary: {}, byStatus: [], byTopic: [], recentDoubts: [] };
    }

    const doubts = await this.doubtRepo.find({
      where: { tenantId, studentId: In(studentIds) },
      relations: ['student', 'student.user', 'topic'],
      order: { createdAt: 'DESC' },
    });

    const total = doubts.length;
    const byStatus = [
      DoubtStatus.OPEN,
      DoubtStatus.AI_RESOLVED,
      DoubtStatus.ESCALATED,
      DoubtStatus.TEACHER_RESOLVED,
    ].map((status) => ({
      status,
      count: doubts.filter((d) => d.status === status).length,
    }));

    // Group by topic
    const topicDoubtMap = new Map<string, { topicName: string; count: number }>();
    for (const d of doubts) {
      if (d.topicId) {
        const key = d.topicId;
        if (!topicDoubtMap.has(key)) {
          topicDoubtMap.set(key, { topicName: d.topic?.name || 'Unknown', count: 0 });
        }
        topicDoubtMap.get(key)!.count++;
      }
    }

    const byTopic = Array.from(topicDoubtMap.entries())
      .map(([topicId, v]) => ({ topicId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const resolved = doubts.filter((d) => d.status === DoubtStatus.TEACHER_RESOLVED);
    const avgResolutionMinutes =
      resolved.length
        ? resolved
            .filter((d) => d.resolvedAt)
            .reduce((sum, d) => {
              const mins = (new Date(d.resolvedAt).getTime() - new Date(d.createdAt).getTime()) / 60000;
              return sum + mins;
            }, 0) / resolved.length
        : 0;

    const aiResolvedCount = doubts.filter((d) => d.status === DoubtStatus.AI_RESOLVED).length;
    const teacherResolvedCount = resolved.length;

    return {
      summary: {
        total,
        openEscalated: doubts.filter(
          (d) => d.status === DoubtStatus.ESCALATED || d.status === DoubtStatus.OPEN,
        ).length,
        aiResolved: aiResolvedCount,
        teacherResolved: teacherResolvedCount,
        avgResolutionMinutes: Math.round(avgResolutionMinutes),
        aiResolutionRate: total ? Math.round((aiResolvedCount / total) * 100) : 0,
      },
      byStatus,
      byTopic,
      recentDoubts: doubts.slice(0, 10).map((d) => ({
        id: d.id,
        questionText: d.questionText?.slice(0, 100) || '[image]',
        status: d.status,
        studentName: d.student?.user?.fullName || 'Unknown',
        topicName: d.topic?.name || null,
        createdAt: d.createdAt,
      })),
    };
  }

  // ─── 6. Student Deep Dive ─────────────────────────────────────────────────

  async getStudentDeepDive(
    teacherId: string,
    tenantId: string,
    studentId: string,
    query: TeacherAnalyticsQueryDto,
  ) {
    const { studentIds } = await this.getTeacherStudentIds(teacherId, tenantId, query.batchId);
    if (!studentIds.includes(studentId)) {
      return null;
    }

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenantId },
      relations: ['user'],
    });
    if (!student) return null;

    const [testSessions, lectureProgresses, doubts, weakTopics] = await Promise.all([
      this.testSessionRepo.find({
        where: {
          tenantId,
          studentId,
          status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]),
        },
        order: { submittedAt: 'DESC' },
        take: 20,
      }),
      this.lectureProgressRepo.find({
        where: { tenantId, studentId },
        relations: ['lecture'],
        order: { updatedAt: 'DESC' },
        take: 20,
      }),
      this.doubtRepo.find({
        where: { tenantId, studentId },
        relations: ['topic'],
        order: { createdAt: 'DESC' },
        take: 10,
      }),
      this.weakTopicRepo.find({
        where: { studentId },
        relations: ['topic', 'topic.chapter'],
        order: { updatedAt: 'DESC' },
        take: 10,
      }),
    ]);

    const scores = testSessions.filter((s) => s.totalScore != null).map((s) => s.totalScore);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    const correct = testSessions.reduce((a, b) => a + (b.correctCount || 0), 0);
    const total = testSessions.reduce(
      (a, b) => a + (b.correctCount || 0) + (b.wrongCount || 0),
      0,
    );
    const accuracy = total ? (correct / total) * 100 : 0;

    const avgWatch =
      lectureProgresses.length
        ? lectureProgresses.reduce((a, b) => a + b.watchPercentage, 0) / lectureProgresses.length
        : 0;

    return {
      student: {
        id: student.id,
        name: student.user?.fullName || 'Unknown',
        avatar: student.user?.profilePictureUrl || null,
        email: student.user?.email || null,
        phone: student.user?.phoneNumber || null,
        class: student.class,
        examTarget: student.examTarget,
      },
      performance: {
        avgScore: Math.round(avgScore * 10) / 10,
        accuracy: Math.round(accuracy * 10) / 10,
        quizzesTaken: testSessions.length,
        lecturesWatched: lectureProgresses.filter((lp) => lp.isCompleted).length,
        avgWatchPercentage: Math.round(avgWatch * 10) / 10,
        doubtCount: doubts.length,
      },
      recentQuizzes: testSessions.slice(0, 5).map((s) => ({
        id: s.id,
        mockTestId: s.mockTestId,
        score: s.totalScore,
        correct: s.correctCount,
        wrong: s.wrongCount,
        skipped: s.skippedCount,
        submittedAt: s.submittedAt,
      })),
      lectureActivity: lectureProgresses.slice(0, 5).map((lp) => ({
        lectureId: lp.lectureId,
        lectureTitle: lp.lecture?.title || 'Unknown',
        watchPercentage: lp.watchPercentage,
        isCompleted: lp.isCompleted,
        rewindCount: lp.rewindCount,
        confusionFlags: lp.confusionFlags?.length || 0,
      })),
      weakTopics: weakTopics.map((wt) => ({
        topicId: wt.topicId,
        topicName: wt.topic?.name || 'Unknown',
        chapterName: wt.topic?.chapter?.name || 'Unknown',
        severity: wt.severity,
        accuracy: wt.accuracy,
        wrongCount: wt.wrongCount,
        doubtCount: wt.doubtCount,
      })),
      recentDoubts: doubts.slice(0, 5).map((d) => ({
        id: d.id,
        questionText: d.questionText?.slice(0, 100) || '[image]',
        status: d.status,
        topicName: d.topic?.name || null,
        createdAt: d.createdAt,
      })),
    };
  }

  // ─── 7. Batch Comparison ──────────────────────────────────────────────────

  async getBatchComparison(teacherId: string, tenantId: string, _query: TeacherAnalyticsQueryDto) {
    const batches = await this.getTeacherBatches(teacherId, tenantId);
    if (!batches.length) return [];

    const results = await Promise.all(
      batches.map(async (batch) => {
        const enrollments = await this.enrollmentRepo.find({
          where: { tenantId, batchId: batch.id, status: EnrollmentStatus.ACTIVE },
        });
        const studentIds = enrollments.map((e) => e.studentId);
        if (!studentIds.length) {
          return { batchId: batch.id, batchName: batch.name, studentCount: 0, avgScore: 0, avgWatch: 0, doubtCount: 0 };
        }

        const [testSessions, lectureProgresses, doubts] = await Promise.all([
          this.testSessionRepo.find({
            where: {
              tenantId,
              studentId: In(studentIds),
              status: In([TestSessionStatus.SUBMITTED, TestSessionStatus.AUTO_SUBMITTED]),
            },
          }),
          this.lectureProgressRepo.find({ where: { tenantId, studentId: In(studentIds) } }),
          this.doubtRepo.find({ where: { tenantId, studentId: In(studentIds) } }),
        ]);

        const scores = testSessions.filter((s) => s.totalScore != null).map((s) => s.totalScore);
        const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

        const avgWatch =
          lectureProgresses.length
            ? lectureProgresses.reduce((a, b) => a + b.watchPercentage, 0) / lectureProgresses.length
            : 0;

        return {
          batchId: batch.id,
          batchName: batch.name,
          examTarget: batch.examTarget,
          status: batch.status,
          studentCount: studentIds.length,
          avgScore: Math.round(avgScore * 10) / 10,
          avgWatchPercentage: Math.round(avgWatch * 10) / 10,
          quizAttempts: testSessions.length,
          doubtCount: doubts.length,
          openDoubts: doubts.filter(
            (d) => d.status === DoubtStatus.ESCALATED || d.status === DoubtStatus.OPEN,
          ).length,
        };
      }),
    );

    return results;
  }

  // ─── 8. Smart Insights ────────────────────────────────────────────────────

  async getSmartInsights(teacherId: string, tenantId: string, batchId?: string) {
    const insights: { type: string; severity: 'warning' | 'critical' | 'info'; title: string; description: string; action: string }[] = [];

    // 1. Class performance — low scorers
    const perfData = await this.getClassPerformance(teacherId, tenantId, { batchId, limit: 1000, page: 1 });
    const lowScorers = perfData.data.filter((s) => s.avgScore < 50);
    if (lowScorers.length > 0) {
      insights.push({
        type: 'low-scorers',
        severity: 'critical',
        title: `${lowScorers.length} students scoring below 50%`,
        description: 'These students need immediate attention and extra support.',
        action: 'Schedule extra class or one-on-one session',
      });
    }

    // 2. Topic coverage — weak topics & gate pass
    const topicData = await this.getTopicCoverage(teacherId, tenantId, { batchId });
    const highConfusionTopics = topicData
      .filter((t) => t.affectedPercentage > 50)
      .slice(0, 3);
    for (const topic of highConfusionTopics) {
      insights.push({
        type: 'weak-topic',
        severity: 'warning',
        title: `High confusion on ${topic.topicName}`,
        description: `${topic.affectedStudents} students (${topic.affectedPercentage}%) struggle with this topic.`,
        action: 'Plan to revisit this concept in the next lecture',
      });
    }

    const lowGatePassTopics = topicData
      .filter((t) => t.taught && t.gatePassRate < 60)
      .slice(0, 2);
    for (const topic of lowGatePassTopics) {
      insights.push({
        type: 'gate-lock',
        severity: 'warning',
        title: `Low gate pass rate on ${topic.topicName}`,
        description: `Only ${topic.gatePassRate}% of students passed the gate for this topic.`,
        action: 'Schedule a dedicated revision lecture for this topic',
      });
    }

    // 3. Doubt analytics
    const doubtData = await this.getDoubtAnalytics(teacherId, tenantId, { batchId });
    const openEscalated = (doubtData.summary as any).openEscalated || 0;
    if (openEscalated > 5) {
      insights.push({
        type: 'doubt-backlog',
        severity: 'critical',
        title: `${openEscalated} unanswered doubts pending`,
        description: 'Students are waiting for teacher responses.',
        action: 'Clear doubt queue — answer escalated doubts today',
      });
    }

    const highDoubtTopic = doubtData.byTopic.find((t) => t.count > 3);
    if (highDoubtTopic) {
      insights.push({
        type: 'high-doubt-topic',
        severity: 'info',
        title: `Many doubts on ${highDoubtTopic.topicName}`,
        description: `${highDoubtTopic.count} students raised doubts on this topic.`,
        action: 'Schedule a dedicated/revision lecture for this topic',
      });
    }

    return insights;
  }

  // ─── 9. CSV Export ────────────────────────────────────────────────────────

  async exportCsv(teacherId: string, tenantId: string, query: ExportQueryDto) {
    const type = query.type || 'class-performance';

    if (type === 'class-performance') {
      const result = await this.getClassPerformance(teacherId, tenantId, { ...query, limit: 1000 });
      return result.data.map((row) => ({
        Name: row.name,
        'Quizzes Taken': row.quizzesTaken,
        'Avg Score': row.avgScore,
        'Accuracy (%)': row.accuracy,
        'Avg Watch (%)': row.avgWatchPercentage,
        'Doubt Count': row.doubtCount,
        'Open Doubts': row.openDoubts,
      }));
    }

    if (type === 'doubt-analytics') {
      const result = await this.getDoubtAnalytics(teacherId, tenantId, query);
      return result.recentDoubts.map((d) => ({
        'Student Name': d.studentName,
        Question: d.questionText,
        Status: d.status,
        Topic: d.topicName || '',
        'Created At': d.createdAt,
      }));
    }

    if (type === 'topic-coverage') {
      const data = await this.getTopicCoverage(teacherId, tenantId, query);
      return data.map((t) => ({
        Topic: t.topicName,
        Chapter: t.chapterName,
        Subject: t.subjectName,
        'Affected Students': t.affectedStudents,
        'Affected (%)': t.affectedPercentage,
        'Avg Accuracy (%)': t.avgAccuracy,
        'Total Wrong': t.totalWrong,
        'Total Doubts': t.totalDoubt,
      }));
    }

    return [];
  }
}