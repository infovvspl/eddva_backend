import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Between, In, MoreThan, Not, Repository } from 'typeorm';

import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { NotificationService } from '../notification/notification.service';
import { WeakTopic, WeakTopicSeverity } from '../../database/entities/analytics.entity';
import { MockTest, MockTestType, TopicProgress, TopicStatus } from '../../database/entities/assessment.entity';
import { AiStudySession, Lecture, LectureProgress, LectureStatus, PlanItem, PlanItemStatus, PlanItemType, StudyPlan } from '../../database/entities/learning.entity';
import { ExamTarget, ExamYear, Student } from '../../database/entities/student.entity';
import { Chapter, Subject, Topic } from '../../database/entities/subject.entity';
import { Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

import { StudyPlanRangeQueryDto } from './dto/study-plan.dto';

// ─── Plan item shape ──────────────────────────────────────────────────────────
type RawPlanItem = {
  date: string;
  type: string;
  title: string;
  refId?: string;
  estimatedMinutes?: number;
};

// ─── JEE / NEET subject labels ────────────────────────────────────────────────
const JEE_SUBJECTS  = ['Physics', 'Chemistry', 'Mathematics'];
const NEET_SUBJECTS = ['Physics', 'Chemistry', 'Biology'];
const BOTH_SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];

@Injectable()
export class StudyPlanService {
  private readonly logger = new Logger(StudyPlanService.name);

  constructor(
    @InjectRepository(StudyPlan)
    private readonly studyPlanRepo: Repository<StudyPlan>,
    @InjectRepository(PlanItem)
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(WeakTopic)
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(TopicProgress)
    private readonly topicProgressRepo: Repository<TopicProgress>,
    @InjectRepository(Lecture)
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(MockTest)
    private readonly mockTestRepo: Repository<MockTest>,
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(LectureProgress)
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(AiStudySession)
    private readonly aiStudySessionRepo: Repository<AiStudySession>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  async generatePlan(userId: string, tenantId: string, force: boolean) {
    const student = await this.getStudentByUserId(userId, tenantId);

    // Return existing plan if still valid and not forced
    const existing = await this.studyPlanRepo.findOne({ where: { studentId: student.id, tenantId } });
    if (existing && !force && existing.validUntil && new Date(existing.validUntil) > new Date()) {
      return this.getPlanWithItems(existing.id, tenantId);
    }

    // ── Gather context ──────────────────────────────────────────────────────
    // Determine student's enrolled batch for accurate content filtering
    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, tenantId, status: EnrollmentStatus.ACTIVE },
    }).catch(() => null);
    const batchId = enrollment?.batchId;

    const lectureWhere: any = batchId
      ? { batchId, tenantId, status: LectureStatus.PUBLISHED }
      : { tenantId, status: LectureStatus.PUBLISHED };
    const mockTestWhere: any = batchId
      ? { batchId, tenantId, isPublished: true }
      : { tenantId, isPublished: true };

    const [weakTopicsRaw, allProgress, availableLectures, availableMockTests] = await Promise.all([
      this.weakTopicRepo.find({ where: { studentId: student.id } }),
      this.topicProgressRepo.find({ where: { studentId: student.id } }),
      this.lectureRepo.find({
        where: lectureWhere,
        relations: ['topic'],
        order: { createdAt: 'ASC' },
      }),
      this.mockTestRepo.find({
        where: mockTestWhere,
        order: { createdAt: 'ASC' },
      }),
    ]);

    // Attach topic names using a separate query with tenantId (relations JOIN can miss tenant-scoped rows)
    const topicIds = [...new Set(weakTopicsRaw.map((wt) => wt.topicId).filter(Boolean))];
    const topicsForWeak = topicIds.length
      ? await this.topicRepo.find({ where: { id: In(topicIds), tenantId } })
      : [];
    const topicMap = new Map(topicsForWeak.map((t) => [t.id, t]));
    weakTopicsRaw.forEach((wt) => { wt.topic = topicMap.get(wt.topicId) ?? null as any; });
    const weakTopics = weakTopicsRaw;

    const examDate = this.deriveExamDate(student.examYear);
    const daysToExam = Math.max(1, Math.ceil((examDate.getTime() - Date.now()) / 86400000));

    let items: RawPlanItem[] = [];

    // ── Try AI first ────────────────────────────────────────────────────────
    try {
      const aiResult = (await this.aiBridgeService.generateStudyPlan({
        studentId: student.id,
        examTarget: student.examTarget,
        examYear: student.examYear,
        dailyHours: student.dailyStudyHours,
        weakTopics: weakTopics.map((t) => t.topic?.name ?? t.topicId),
        targetCollege: student.targetCollege,
        academicCalendar: {
          examDate: examDate.toISOString().slice(0, 10),
          strongTopics: allProgress
            .filter((p) => p.status === TopicStatus.COMPLETED)
            .map((p) => p.topicId),
          daysToExam,
        },
      })) as { planItems?: RawPlanItem[]; items?: RawPlanItem[] };

      // Normalize AI response — map old field names (activity/duration_min/topic/subject) to expected ones
      const rawItems: any[] = aiResult.items || aiResult.planItems || [];
      items = rawItems.map((item: any) => ({
        date:               item.date,
        type:               item.type || item.activity || 'practice',
        title:              item.title || item.topic || item.subject || null,
        refId:              item.refId ?? null,
        estimatedMinutes:   item.estimatedMinutes ?? item.duration_min ?? 30,
      }));

      // Re-anchor AI plan to start from today (IST) — AI may return future-dated items
      if (items.length) {
        const todayStr = this.todayIst();
        const firstItemDate = [...items]
          .filter((i) => !!i.date)
          .sort((a, b) => (a.date < b.date ? -1 : 1))[0]?.date;
        if (firstItemDate && firstItemDate !== todayStr) {
          const shiftDays = Math.round(
            (new Date(`${todayStr}T00:00:00Z`).getTime() -
              new Date(`${firstItemDate}T00:00:00Z`).getTime()) /
              86400000,
          );
          items = items.map((item) => {
            if (!item.date) return item;
            const d = new Date(`${item.date}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + shiftDays);
            return { ...item, date: d.toISOString().slice(0, 10) };
          });
        }
      }
    } catch {
      this.logger.warn(`AI study-plan unavailable for student ${student.id} — using comprehensive engine`);
    }

    // ── Fallback: comprehensive rule-based engine ───────────────────────────
    if (!items.length) {
      items = this.buildComprehensivePlan(
        student,
        weakTopics,
        availableLectures,
        availableMockTests,
        daysToExam,
      );
    }

    // ── Fix refIds: map AI-generated topic names to real lecture/quiz IDs ──
    items = this.applyBatchRefIds(items, availableLectures, availableMockTests);

    // ── Fallback: lecture items still without refId get the first unwatched lecture ──
    const unwatchedLecture = availableLectures[0];
    if (unwatchedLecture) {
      items = items.map((item) => {
        if ((item.type === 'lecture') && !item.refId) {
          return { ...item, refId: unwatchedLecture.id };
        }
        if ((item.type === 'practice' || item.type === 'revision') && !item.refId && unwatchedLecture.topicId) {
          return { ...item, refId: unwatchedLecture.topicId };
        }
        return item;
      });
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    const planDays = Math.min(30, Math.max(7, daysToExam - 5));
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + planDays);

    const plan = await this.studyPlanRepo.manager.transaction(async (manager) => {
      const current = await manager.findOne(StudyPlan, { where: { studentId: student.id, tenantId } });
      if (current) {
        await manager.delete(PlanItem, { studyPlanId: current.id });
        await manager.delete(StudyPlan, { id: current.id });
      }

      const created = await manager.save(
        manager.create(StudyPlan, {
          studentId: student.id,
          tenantId,
          generatedAt: new Date(),
          validUntil,
          aiVersion: 'comprehensive-v2',
        }),
      );

      const planItems = items
        .filter((item) => !!item.date && !!item.type) // drop malformed AI items
        .map((item, i) =>
          manager.create(PlanItem, {
            studyPlanId: created.id,
            scheduledDate: item.date,
            type: this.mapPlanItemType(item.type),
            refId: item.refId ?? null,
            // AI bridge may return null/undefined titles — use a safe fallback
            title: item.title || `${item.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Session`,
            estimatedMinutes: item.estimatedMinutes ?? 30,
            sortOrder: i,
            status: PlanItemStatus.PENDING,
          }),
        );

      if (planItems.length) await manager.save(planItems);
      return created;
    });

    // ── Spaced repetition: add revision tasks for topics passed 7/21/45 days ago ──
    await this.addRevisionTasks(student.id, tenantId).catch(() => {});

    if (force) {
      await this.notificationService.send({
        userId,
        tenantId,
        title: 'Your study plan has been updated!',
        body: '📅 Your personalised study plan has been refreshed based on your latest progress.',
        channels: ['push', 'in_app'],
        refType: 'study_plan_regenerated',
        refId: plan.id,
      });
    }

    return this.getPlanWithItems(plan.id, tenantId);
  }

  async getToday(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const plan = await this.studyPlanRepo.findOne({ where: { studentId: student.id, tenantId } });
    if (!plan) return [];

    const today = this.todayIst();
    const items = await this.planItemRepo.find({
      where: { studyPlanId: plan.id, scheduledDate: today },
      order: { sortOrder: 'ASC' },
    });

    return this.resolvePlanItems(items, tenantId, student.id);
  }

  async getRange(userId: string, tenantId: string, query: StudyPlanRangeQueryDto) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const plan = await this.studyPlanRepo.findOne({ where: { studentId: student.id, tenantId } });
    if (!plan) return {};

    const { startDate, endDate } = this.resolveRange(query);
    const items = await this.planItemRepo
      .createQueryBuilder('item')
      .where('item.studyPlanId = :studyPlanId', { studyPlanId: plan.id })
      .andWhere('item.scheduledDate >= :startDate', { startDate })
      .andWhere('item.scheduledDate <= :endDate', { endDate })
      .orderBy('item.scheduledDate', 'ASC')
      .addOrderBy('item.sortOrder', 'ASC')
      .getMany();

    const resolved = await this.resolvePlanItems(items, tenantId, student.id);
    return resolved.reduce<Record<string, typeof resolved>>((acc, item) => {
      if (!acc[item.scheduledDate]) acc[item.scheduledDate] = [];
      acc[item.scheduledDate].push(item);
      return acc;
    }, {});
  }

  async completeItem(itemId: string, userId: string, tenantId: string) {
    const { item, student } = await this.getOwnedItem(itemId, userId, tenantId);
    item.status = PlanItemStatus.COMPLETED;
    item.completedAt = new Date();
    await this.planItemRepo.save(item);

    const xp = this.xpForItem(item.type);
    student.xpTotal = (student.xpTotal || 0) + xp;
    await this.studentRepo.save(student);

    return { item, xpAwarded: xp, totalXp: student.xpTotal };
  }

  async skipItem(itemId: string, userId: string, tenantId: string) {
    const { item } = await this.getOwnedItem(itemId, userId, tenantId);
    item.status = PlanItemStatus.SKIPPED;
    await this.planItemRepo.save(item);

    const nextDate = await this.findNextAvailableDate(item.studyPlanId, item.scheduledDate);
    const rescheduled = await this.planItemRepo.save(
      this.planItemRepo.create({
        studyPlanId: item.studyPlanId,
        scheduledDate: nextDate,
        type: item.type,
        refId: item.refId,
        title: item.title,
        estimatedMinutes: item.estimatedMinutes,
        sortOrder: item.sortOrder,
        status: PlanItemStatus.RESCHEDULED,
      }),
    );

    return { skipped: item, rescheduled };
  }

  @Cron('0 1 * * 1', { timeZone: 'Asia/Kolkata' })
  async weeklyPlanReview() {
    const students = await this.studentRepo.find({ where: { diagnosticCompleted: true } });
    for (const student of students) {
      const plan = await this.studyPlanRepo.findOne({
        where: { studentId: student.id, tenantId: student.tenantId },
      });

      if (!plan) {
        // Auto-generate plan for students who completed diagnostic but have no plan
        await this.generatePlan(student.userId, student.tenantId, false).catch(() => {});
        continue;
      }

      if (plan.validUntil && new Date(plan.validUntil) <= new Date()) {
        // Plan expired — regenerate
        await this.generatePlan(student.userId, student.tenantId, true).catch(() => {});
        continue;
      }

      const items = await this.planItemRepo.find({ where: { studyPlanId: plan.id } });
      if (!items.length) continue;

      const completed = items.filter((i) => i.status === PlanItemStatus.COMPLETED).length;
      const percent = (completed / items.length) * 100;

      // Always run spaced repetition revision tasks on Monday
      await this.addRevisionTasks(student.id, student.tenantId).catch(() => {});

      if (percent > 60) {
        // Student is ahead — regenerate with higher difficulty
        await this.generatePlan(student.userId, student.tenantId, true).catch(() => {});
      } else if (percent < 20) {
        await this.notificationService.send({
          userId: student.userId,
          tenantId: student.tenantId,
          title: `Only ${Math.round(percent)}% of your plan done — let's catch up!`,
          body: `⚠️ You've completed only ${Math.round(percent)}% of this week's plan. Small steps add up!`,
          channels: ['push', 'in_app'],
          refType: 'study_plan_nudge',
          refId: plan.id,
        });
      }
    }
  }

  // ─── Learning loop: gate pass → unlock next topic ────────────────────────────

  async onTopicGatePassed(studentId: string, topicId: string, tenantId: string) {
    const currentTopic = await this.topicRepo.findOne({ where: { id: topicId, tenantId } });
    if (!currentTopic) return;

    // Find next topic in the same chapter by sortOrder
    const nextTopic = await this.topicRepo.findOne({
      where: { chapterId: currentTopic.chapterId, sortOrder: MoreThan(currentTopic.sortOrder), tenantId, isActive: true },
      order: { sortOrder: 'ASC' },
    });
    if (!nextTopic) return;

    // Unlock next topic in TopicProgress
    const existing = await this.topicProgressRepo.findOne({ where: { studentId, topicId: nextTopic.id, tenantId } });
    if (!existing || existing.status === TopicStatus.LOCKED) {
      await this.topicProgressRepo.save(
        this.topicProgressRepo.create({
          ...(existing ?? {}),
          studentId,
          topicId: nextTopic.id,
          tenantId,
          status: TopicStatus.UNLOCKED,
          unlockedAt: new Date(),
          attemptCount: existing?.attemptCount ?? 0,
          bestAccuracy: existing?.bestAccuracy ?? 0,
        }),
      );
    }

    // Find the student's enrollment to get batchId
    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId, tenantId, status: EnrollmentStatus.ACTIVE },
    }).catch(() => null);
    if (!enrollment) return;

    // Find next lecture in batch for the next topic
    const nextLecture = await this.lectureRepo.findOne({
      where: { topicId: nextTopic.id, batchId: enrollment.batchId, status: LectureStatus.PUBLISHED, tenantId },
      order: { createdAt: 'ASC' },
    });

    const studyPlan = await this.studyPlanRepo.findOne({ where: { studentId, tenantId } });
    if (!studyPlan) return;

    const refId = nextLecture?.id ?? nextTopic.id;
    const itemType = nextLecture ? PlanItemType.LECTURE : PlanItemType.PRACTICE;

    // Skip if task already in plan
    const alreadyIn = await this.planItemRepo.findOne({
      where: { studyPlanId: studyPlan.id, refId, status: Not(PlanItemStatus.SKIPPED) },
    });
    if (alreadyIn) return;

    // Schedule after the last existing task
    const lastTask = await this.planItemRepo.findOne({
      where: { studyPlanId: studyPlan.id },
      order: { scheduledDate: 'DESC', sortOrder: 'DESC' },
    });
    const nextDate = this.addDays(lastTask?.scheduledDate ?? this.todayIst(), 1);

    await this.planItemRepo.save(
      this.planItemRepo.create({
        studyPlanId: studyPlan.id,
        scheduledDate: nextDate,
        type: itemType,
        refId,
        title: nextLecture ? `Watch: ${nextLecture.title}` : `Study: ${nextTopic.name}`,
        estimatedMinutes: nextLecture
          ? Math.ceil((nextLecture.videoDurationSeconds || 2700) / 60)
          : nextTopic.estimatedStudyMinutes || 45,
        sortOrder: 0,
        status: PlanItemStatus.PENDING,
      }),
    );
  }

  // ─── Spaced repetition: add revision tasks ────────────────────────────────

  async addRevisionTasks(studentId: string, tenantId: string) {
    const passedTopics = await this.topicProgressRepo.find({
      where: { studentId, tenantId, status: TopicStatus.COMPLETED },
      relations: ['topic'],
    });
    if (!passedTopics.length) return;

    const studyPlan = await this.studyPlanRepo.findOne({ where: { studentId, tenantId } });
    if (!studyPlan) return;

    const today = this.todayIst();
    const weekStart = this.addDays(today, -new Date(today).getDay());
    const weekEnd   = this.addDays(weekStart, 6);

    for (const tp of passedTopics) {
      if (!tp.completedAt || !tp.topic) continue;
      const daysSince = Math.floor((Date.now() - new Date(tp.completedAt).getTime()) / 86400000);
      const isDue =
        (daysSince >= 7  && daysSince < 8)  ||
        (daysSince >= 21 && daysSince < 22) ||
        (daysSince >= 45 && daysSince < 46);
      if (!isDue) continue;

      // Skip if revision already scheduled this week
      const existingRev = await this.planItemRepo.findOne({
        where: {
          studyPlanId: studyPlan.id,
          type: PlanItemType.REVISION,
          refId: tp.topicId,
          scheduledDate: Between(weekStart, weekEnd),
          status: Not(PlanItemStatus.SKIPPED),
        },
      });
      if (existingRev) continue;

      // Find a free slot in the next 3 days (max 5 tasks/day)
      for (let i = 1; i <= 3; i++) {
        const candidate = this.addDays(today, i);
        const count = await this.planItemRepo.count({
          where: { studyPlanId: studyPlan.id, scheduledDate: candidate, status: Not(PlanItemStatus.SKIPPED) },
        });
        if (count < 5) {
          await this.planItemRepo.save(
            this.planItemRepo.create({
              studyPlanId: studyPlan.id,
              scheduledDate: candidate,
              type: PlanItemType.REVISION,
              refId: tp.topicId,
              title: `Revise: ${tp.topic.name}`,
              estimatedMinutes: Math.max(20, Math.ceil((tp.topic.estimatedStudyMinutes || 60) / 2)),
              sortOrder: count,
              status: PlanItemStatus.PENDING,
            }),
          );
          break;
        }
      }
    }
  }

  // ─── What to do next ──────────────────────────────────────────────────────

  async getNextAction(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const plan = await this.studyPlanRepo.findOne({ where: { studentId: student.id, tenantId } });
    if (!plan) {
      return { action: 'all_done', title: 'No study plan yet!', description: 'Generate your personalised plan to get started.', xpReward: 0 };
    }

    // Look for today's pending tasks first, then tomorrow's
    for (const offset of [0, 1]) {
      const date = this.addDays(this.todayIst(), offset);
      const pending = await this.planItemRepo.find({
        where: { studyPlanId: plan.id, scheduledDate: date, status: PlanItemStatus.PENDING },
        order: { sortOrder: 'ASC' },
      });
      if (!pending.length) continue;

      const item = pending[0];
      const resolved = await this.resolvePlanItems([item], tenantId, student.id);
      const r = resolved[0] as any;
      const content = r.content ?? {};

      switch (item.type) {
        case PlanItemType.LECTURE:
          return {
            action: 'watch_lecture',
            title: item.title,
            description: `${content.topicName ?? ''} · ${content.videoDurationSeconds ? Math.ceil(content.videoDurationSeconds / 60) + ' min' : ''}`.trim(),
            lectureId: item.refId,
            planItemId: item.id,
            topicName: content.topicName,
            subjectName: content.subjectName,
            estimatedMinutes: item.estimatedMinutes,
            xpReward: 10,
          };
        case PlanItemType.MOCK_TEST:
          return {
            action: 'take_quiz',
            title: item.title,
            description: `${content.questionCount ?? '?'} questions · ${content.durationMinutes ?? '?'} min`,
            mockTestId: item.refId,
            planItemId: item.id,
            estimatedMinutes: item.estimatedMinutes,
            xpReward: 20,
          };
        case PlanItemType.PRACTICE:
          return {
            action: 'ai_study',
            title: item.title,
            description: `Practice: ${content.topicName ?? item.title}`,
            topicId: item.refId,
            planItemId: item.id,
            topicName: content.topicName,
            subjectName: content.subjectName,
            estimatedMinutes: item.estimatedMinutes,
            xpReward: 8,
          };
        case PlanItemType.REVISION:
          return {
            action: 'revision',
            title: item.title,
            description: `Spaced revision · ${content.chapterName ?? ''}`,
            topicId: item.refId,
            planItemId: item.id,
            topicName: content.topicName,
            subjectName: content.subjectName,
            estimatedMinutes: item.estimatedMinutes,
            xpReward: 6,
          };
        case PlanItemType.BATTLE:
          return { action: 'battle', title: item.title, description: 'Challenge a classmate and earn XP', estimatedMinutes: 30, xpReward: 25 };
        default:
          return { action: 'ai_study', title: item.title, description: item.title, topicId: item.refId, planItemId: item.id, estimatedMinutes: item.estimatedMinutes, xpReward: 5 };
      }
    }

    return { action: 'all_done', title: "All tasks done today! 🎉 Battle time?", description: 'You crushed today\'s plan. Try a battle or review weak topics.', xpReward: 0 };
  }

  // ─── Comprehensive plan engine ──────────────────────────────────────────────

  /**
   * Generates a personalised 30-day study plan without requiring the AI service.
   *
   * Structure:
   *  Phase 1 — Foundation    (Days 1–12):  Learn weak topics via lectures + heavy practice
   *  Phase 2 — Consolidation (Days 13–21): Deepen with revision, chapter mocks, doubt clearing
   *  Phase 3 — Testing       (Days 22–30): Speed drills, full mock tests, battle challenges
   *
   * Daily rhythm (respects dailyStudyHours):
   *  - Regular days:  Lecture → Practice → Revision (distributed across available time)
   *  - Wednesday:     Doubt session + revision
   *  - Thursday:      Battle arena + speed drill
   *  - Saturday:      Chapter mock test + error review
   *  - Sunday:        Full mock test + comprehensive revision
   */
  private buildComprehensivePlan(
    student: Student,
    weakTopics: WeakTopic[],
    lectures: Lecture[],
    mockTests: MockTest[],
    daysToExam: number,
  ): RawPlanItem[] {
    const planDays = Math.min(30, Math.max(7, daysToExam - 5));
    const dailyMinutes = Math.round((student.dailyStudyHours ?? 3) * 60);
    // Use IST date as the anchor — must match what getToday() uses
    const todayIstStr = this.todayIst();

    // ── Classify weak topics by severity ─────────────────────────────────────
    const critical = weakTopics.filter((t) => t.severity === WeakTopicSeverity.CRITICAL);
    const high     = weakTopics.filter((t) => t.severity === WeakTopicSeverity.HIGH);
    const medium   = weakTopics.filter((t) => t.severity === WeakTopicSeverity.MEDIUM);

    // Ordered queue: critical → high → medium → cycle back
    const weakQueue = [...critical, ...high, ...medium];

    // ── Subject rotation ──────────────────────────────────────────────────────
    const subjects =
      student.examTarget === ExamTarget.NEET
        ? NEET_SUBJECTS
        : student.examTarget === ExamTarget.BOTH
          ? BOTH_SUBJECTS
          : JEE_SUBJECTS;

    // ── Index lectures by topicId ─────────────────────────────────────────────
    const lectureByTopic = new Map<string, Lecture[]>();
    for (const lec of lectures) {
      if (!lec.topicId) continue;
      if (!lectureByTopic.has(lec.topicId)) lectureByTopic.set(lec.topicId, []);
      lectureByTopic.get(lec.topicId)!.push(lec);
    }

    // ── Available full-mock tests ─────────────────────────────────────────────
    const fullMocks = mockTests.filter((m) => m.type === MockTestType.FULL_MOCK);
    const chapterMocks = mockTests.filter(
      (m) => m.type === MockTestType.CHAPTER_TEST || m.type === MockTestType.DIAGNOSTIC,
    );

    const items: RawPlanItem[] = [];
    let subjectIdx = 0;
    let weakIdx = 0;
    let fullMockIdx = 0;
    let chapterMockIdx = 0;

    for (let day = 0; day < planDays; day++) {
      // Compute date using IST anchor to stay consistent with getToday()
      const date = new Date(`${todayIstStr}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + day);
      const dateStr = date.toISOString().slice(0, 10);
      const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat

      const phase: 'foundation' | 'consolidation' | 'testing' =
        day < 12 ? 'foundation' : day < 21 ? 'consolidation' : 'testing';

      // ── Sunday: Full mock test ──────────────────────────────────────────────
      if (dow === 0) {
        const mock = fullMocks.length ? fullMocks[fullMockIdx++ % fullMocks.length] : null;
        items.push({
          date: dateStr,
          type: 'mock_test',
          title: mock ? `Full Mock: ${mock.title}` : 'Weekly Full Mock Test',
          refId: mock?.id,
          estimatedMinutes: Math.min(dailyMinutes, 180),
        });
        if (dailyMinutes > 180) {
          items.push({
            date: dateStr,
            type: 'revision',
            title: 'Analyse Mock Errors — Deep Review',
            estimatedMinutes: Math.min(dailyMinutes - 180, 60),
          });
        }
        continue;
      }

      // ── Saturday: Chapter mock + targeted revision ──────────────────────────
      if (dow === 6) {
        const mock = chapterMocks.length ? chapterMocks[chapterMockIdx++ % chapterMocks.length] : null;
        const mockMinutes = Math.min(90, Math.floor(dailyMinutes * 0.55));
        items.push({
          date: dateStr,
          type: 'mock_test',
          title: mock ? `Chapter Test: ${mock.title}` : 'Chapter Practice Test',
          refId: mock?.id,
          estimatedMinutes: mockMinutes,
        });
        items.push({
          date: dateStr,
          type: 'revision',
          title: 'Weekly Weak Areas Revision',
          estimatedMinutes: Math.max(30, dailyMinutes - mockMinutes),
        });
        continue;
      }

      // ── Thursday: Battle Arena + Doubt clearing ─────────────────────────────
      if (dow === 4 && phase !== 'foundation') {
        const wt = weakQueue.length ? weakQueue[weakIdx % weakQueue.length] : null;
        items.push({
          date: dateStr,
          type: 'battle',
          title: '⚔️ Battle Arena — Challenge a Classmate',
          estimatedMinutes: 30,
        });
        items.push({
          date: dateStr,
          type: 'doubt_session',
          title: 'Clear Accumulated Doubts',
          estimatedMinutes: 30,
        });
        if (dailyMinutes > 60 && wt) {
          items.push({
            date: dateStr,
            type: 'practice',
            title: `Speed Drill: ${wt.topic?.name ?? 'Weak Topic'}`,
            estimatedMinutes: dailyMinutes - 60,
          });
        }
        continue;
      }

      // ── Wednesday: Doubt session + revision ────────────────────────────────
      if (dow === 3 && phase !== 'foundation') {
        const wt = weakQueue.length ? weakQueue[weakIdx % weakQueue.length] : null;
        items.push({
          date: dateStr,
          type: 'doubt_session',
          title: 'Doubt Clearing Session',
          estimatedMinutes: Math.min(45, Math.floor(dailyMinutes * 0.35)),
        });
        if (wt) {
          items.push({
            date: dateStr,
            type: 'revision',
            title: `Targeted Revision: ${wt.topic?.name ?? 'Weak Topic'}`,
            estimatedMinutes: Math.max(30, dailyMinutes - 45),
          });
        }
        continue;
      }

      // ── Regular study days (Mon / Tue / Wed-foundation / Thu-foundation / Fri) ──
      const subject = subjects[subjectIdx % subjects.length];
      subjectIdx++;

      const wt = weakQueue.length ? weakQueue[weakIdx % weakQueue.length] : null;
      if (weakQueue.length) weakIdx++;

      const topicName = wt?.topic?.name ?? `${subject} Core Concepts`;

      // Find a real lecture for this weak topic
      const lecture = wt ? (lectureByTopic.get(wt.topicId)?.[0] ?? null) : null;

      if (phase === 'foundation') {
        // Foundation: Lecture → Practice → Light revision
        this.addFoundationDay(items, dateStr, dailyMinutes, subject, topicName, lecture, wt, weakQueue, weakIdx);
      } else if (phase === 'consolidation') {
        // Consolidation: Revision → Practice → Doubt
        this.addConsolidationDay(items, dateStr, dailyMinutes, subject, topicName, wt);
      } else {
        // Testing: Speed drills → targeted practice
        this.addTestingDay(items, dateStr, dailyMinutes, subject, topicName, wt);
      }
    }

    return items;
  }

  /** Foundation day: learn + practice + light revision */
  private addFoundationDay(
    items: RawPlanItem[],
    date: string,
    dailyMinutes: number,
    subject: string,
    topicName: string,
    lecture: Lecture | null,
    wt: WeakTopic | null,
    weakQueue: WeakTopic[],
    weakIdx: number,
  ) {
    const lectureMinutes = Math.min(60, Math.floor(dailyMinutes * 0.40));
    const practiceMinutes = Math.floor(dailyMinutes * 0.40);
    const revisionMinutes = dailyMinutes - lectureMinutes - practiceMinutes;

    // Lecture slot — link real lecture if available
    if (lecture) {
      items.push({
        date,
        type: 'lecture',
        title: `▶ ${lecture.title}`,
        refId: lecture.id,
        estimatedMinutes: lectureMinutes,
      });
    } else {
      items.push({
        date,
        type: 'lecture',
        title: `Study: ${topicName} (${subject})`,
        estimatedMinutes: lectureMinutes,
      });
    }

    // Practice slot
    items.push({
      date,
      type: 'practice',
      title: `Practice Questions: ${topicName}`,
      estimatedMinutes: practiceMinutes,
    });

    // Revision slot (if enough time)
    if (revisionMinutes >= 20) {
      const prevTopic = weakQueue.length > 1 ? weakQueue[(weakIdx - 2 + weakQueue.length) % weakQueue.length] : wt;
      items.push({
        date,
        type: 'revision',
        title: `Quick Revise: ${prevTopic?.topic?.name ?? topicName}`,
        estimatedMinutes: revisionMinutes,
      });
    }
  }

  /** Consolidation day: deep revision + mixed practice */
  private addConsolidationDay(
    items: RawPlanItem[],
    date: string,
    dailyMinutes: number,
    subject: string,
    topicName: string,
    wt: WeakTopic | null,
  ) {
    const revisionMinutes = Math.floor(dailyMinutes * 0.50);
    const practiceMinutes = dailyMinutes - revisionMinutes;

    items.push({
      date,
      type: 'revision',
      title: `Deep Revision: ${topicName}`,
      estimatedMinutes: revisionMinutes,
    });
    items.push({
      date,
      type: 'practice',
      title: `${subject} Mixed Practice Set${wt ? ` — Focus: ${topicName}` : ''}`,
      estimatedMinutes: practiceMinutes,
    });
  }

  /** Testing phase day: speed drills */
  private addTestingDay(
    items: RawPlanItem[],
    date: string,
    dailyMinutes: number,
    subject: string,
    topicName: string,
    wt: WeakTopic | null,
  ) {
    const drillMinutes = Math.floor(dailyMinutes * 0.60);
    const flashMinutes = dailyMinutes - drillMinutes;

    items.push({
      date,
      type: 'practice',
      title: `⚡ High-Speed Drill: ${subject}${wt ? ` — ${topicName}` : ''}`,
      estimatedMinutes: drillMinutes,
    });
    items.push({
      date,
      type: 'revision',
      title: `Flash Cards Revision: ${topicName}`,
      estimatedMinutes: flashMinutes,
    });
  }

  // ─── Helper methods ──────────────────────────────────────────────────────────

  private async getOwnedItem(itemId: string, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const item = await this.planItemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Plan item ${itemId} not found`);

    const plan = await this.studyPlanRepo.findOne({
      where: { id: item.studyPlanId, studentId: student.id, tenantId },
    });
    if (!plan) throw new ForbiddenException('You do not own this plan item');

    return { item, plan, student };
  }

  private async getPlanWithItems(planId: string, tenantId: string) {
    const plan = await this.studyPlanRepo.findOne({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundException('Study plan not found');
    const items = await this.planItemRepo.find({
      where: { studyPlanId: plan.id },
      order: { scheduledDate: 'ASC', sortOrder: 'ASC' },
    });
    return { ...plan, items: await this.resolvePlanItems(items, tenantId) };
  }

  private async resolvePlanItems(items: PlanItem[], tenantId: string, studentId?: string) {
    const lectureIds  = items.filter((i) => i.type === PlanItemType.LECTURE  && i.refId).map((i) => i.refId!);
    const mockTestIds = items.filter((i) => i.type === PlanItemType.MOCK_TEST && i.refId).map((i) => i.refId!);
    const topicRefIds = items.filter((i) => (i.type === PlanItemType.PRACTICE || i.type === PlanItemType.REVISION) && i.refId).map((i) => i.refId!);

    const [lectures, mockTests, topics, lectureProgresses] = await Promise.all([
      lectureIds.length  ? this.lectureRepo.find({ where: { id: In(lectureIds), tenantId }, relations: ['topic', 'topic.chapter', 'topic.chapter.subject'] }) : [],
      mockTestIds.length ? this.mockTestRepo.find({ where: { id: In(mockTestIds), tenantId } }) : [],
      topicRefIds.length ? this.topicRepo.find({ where: { id: In(topicRefIds), tenantId }, relations: ['chapter', 'chapter.subject'] }) : [],
      (studentId && lectureIds.length)
        ? this.lectureProgressRepo.find({ where: { studentId, lectureId: In(lectureIds) } })
        : [],
    ]);

    const progressByLecture = new Map<string, LectureProgress>(
      (lectureProgresses as LectureProgress[]).map((p) => [p.lectureId, p] as [string, LectureProgress]),
    );

    return items.map((item) => {
      if (item.type === PlanItemType.LECTURE && item.refId) {
        const lec = lectures.find((l) => l.id === item.refId);
        const lp  = progressByLecture.get(item.refId);
        return {
          ...item,
          content: {
            lectureId: lec?.id,
            lectureTitle: lec?.title || item.title,
            topicName: lec?.topic?.name ?? null,
            subjectName: lec?.topic?.chapter?.subject?.name ?? null,
            thumbnailUrl: lec?.thumbnailUrl ?? null,
            videoDurationSeconds: lec?.videoDurationSeconds ?? null,
            watchPercentage: lp?.watchPercentage ?? 0,
          },
        };
      }
      if (item.type === PlanItemType.MOCK_TEST && item.refId) {
        const mt = mockTests.find((m) => m.id === item.refId);
        return {
          ...item,
          content: {
            mockTestId: mt?.id,
            questionCount: (mt?.questionIds as string[] | null)?.length ?? null,
            durationMinutes: mt?.durationMinutes ?? null,
          },
        };
      }
      if ((item.type === PlanItemType.PRACTICE || item.type === PlanItemType.REVISION) && item.refId) {
        const topic = topics.find((t) => t.id === item.refId);
        return {
          ...item,
          content: {
            topicId: topic?.id ?? item.refId,
            topicName: topic?.name ?? item.title,
            chapterName: topic?.chapter?.name ?? null,
            subjectName: topic?.chapter?.subject?.name ?? null,
          },
        };
      }
      return item;
    });
  }

  private resolveRange(query: StudyPlanRangeQueryDto) {
    if (query.startDate && query.endDate) {
      return { startDate: query.startDate, endDate: query.endDate };
    }
    const today = new Date();
    const day = today.getUTCDay() || 7;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      startDate: monday.toISOString().slice(0, 10),
      endDate:   sunday.toISOString().slice(0, 10),
    };
  }

  private todayIst() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  private deriveExamDate(examYear: ExamYear): Date {
    return new Date(`${examYear}-04-30T00:00:00.000Z`);
  }

  private mapPlanItemType(type: string): PlanItemType {
    switch (type) {
      case 'lecture':       return PlanItemType.LECTURE;
      case 'practice':      return PlanItemType.PRACTICE;
      case 'revision':      return PlanItemType.REVISION;
      case 'mock_test':     return PlanItemType.MOCK_TEST;
      case 'doubt_session': return PlanItemType.DOUBT_SESSION;
      case 'battle':        return PlanItemType.BATTLE;
      default:              return PlanItemType.PRACTICE;
    }
  }

  private xpForItem(type: PlanItemType): number {
    switch (type) {
      case PlanItemType.LECTURE:       return 10;
      case PlanItemType.PRACTICE:      return 8;
      case PlanItemType.REVISION:      return 6;
      case PlanItemType.MOCK_TEST:     return 20;
      case PlanItemType.BATTLE:        return 25;
      case PlanItemType.DOUBT_SESSION: return 5;
      default: return 5;
    }
  }

  private async findNextAvailableDate(studyPlanId: string, afterDate: string): Promise<string> {
    const items = await this.planItemRepo.find({
      where: { studyPlanId },
      order: { scheduledDate: 'ASC' },
    });
    const existing = new Set(items.map((i) => i.scheduledDate));
    const cursor = new Date(`${afterDate}T00:00:00.000Z`);
    do {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } while (existing.has(cursor.toISOString().slice(0, 10)));
    return cursor.toISOString().slice(0, 10);
  }

  /** Fix AI-generated items: map topic names to real lecture/quiz IDs */
  private applyBatchRefIds(items: RawPlanItem[], lectures: Lecture[], mockTests: MockTest[]): RawPlanItem[] {
    // Build lookup: topicId → { lectureId, mockTestId, estimatedMinutes }
    const byTopicId = new Map<string, { lectureId: string; mockTestId?: string; estimatedMinutes: number }>();
    for (const lec of lectures) {
      if (!lec.topicId) continue;
      if (!byTopicId.has(lec.topicId)) {
        const mt = mockTests.find((m) => m.topicId === lec.topicId);
        byTopicId.set(lec.topicId, {
          lectureId: lec.id,
          mockTestId: mt?.id,
          estimatedMinutes: Math.ceil((lec.videoDurationSeconds || 2700) / 60),
        });
      }
    }
    // Build lookup: lowercase topic name → topicId (via lecture's topic relation)
    const byTopicName = new Map<string, string>();
    for (const lec of lectures) {
      if (lec.topicId && lec.topic?.name) {
        byTopicName.set(lec.topic.name.toLowerCase(), lec.topicId);
      }
    }

    return items.map((item) => {
      // Only fix items without a valid refId
      if (item.refId) return item;

      // Try to resolve topicId from the item title
      const titleLower = (item.title ?? '').toLowerCase();
      let resolvedTopicId: string | undefined;
      for (const [name, tid] of byTopicName.entries()) {
        if (titleLower.includes(name) || name.includes(titleLower.replace(/^(study|watch|practice|revise)[: ]+/i, ''))) {
          resolvedTopicId = tid;
          break;
        }
      }
      if (!resolvedTopicId) return item;

      const lookup = byTopicId.get(resolvedTopicId);
      if (!lookup) return item;

      switch (item.type) {
        case 'lecture':
          return { ...item, refId: lookup.lectureId, estimatedMinutes: item.estimatedMinutes ?? lookup.estimatedMinutes };
        case 'mock_test':
          return lookup.mockTestId ? { ...item, refId: lookup.mockTestId } : item;
        case 'practice':
        case 'revision':
          return { ...item, refId: resolvedTopicId };
        default:
          return item;
      }
    });
  }

  /** Add N days to a YYYY-MM-DD string */
  private addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private async getStudentByUserId(userId: string, tenantId: string): Promise<Student> {
    const student = await this.studentRepo.findOne({ where: { userId, tenantId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }
}
