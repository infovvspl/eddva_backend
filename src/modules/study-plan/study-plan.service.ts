import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Between, In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { NotificationService } from '../notification/notification.service';
import { WeakTopic, WeakTopicSeverity } from '../../database/entities/analytics.entity';
import { MockTest, MockTestType, TopicProgress, TopicStatus } from '../../database/entities/assessment.entity';
import { AiStudySession, Lecture, LectureProgress, LectureStatus, PlanItem, PlanItemStatus, PlanItemType, StudyPlan } from '../../database/entities/learning.entity';
import { ExamTarget, ExamYear, Student, StudentClass } from '../../database/entities/student.entity';
import { Chapter, ResourceType, Subject, Topic, TopicResource } from '../../database/entities/subject.entity';
import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

import { StudyPlanRangeQueryDto } from './dto/study-plan.dto';
import { GenerateStudyPlanDto } from './dto/study-plan.dto';

// ─── Plan item shape ──────────────────────────────────────────────────────────
type RawPlanItem = {
  date: string;
  type: string;
  title: string;
  refId?: string;
  estimatedMinutes?: number;
  subjectName?: string;
};

type PlanGenerationChoices = {
  targetExam: string;
  examYear: string;
  currentClass: string;
  dailyStudyHours: number;
};

// ─── JEE / NEET subject labels ────────────────────────────────────────────────
const JEE_SUBJECTS  = ['Physics', 'Chemistry', 'Mathematics'];
const NEET_SUBJECTS = ['Physics', 'Chemistry', 'Biology'];
const BOTH_SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];
const MONTHLY_PLAN_CACHE_VERSION = 'monthly-v2';

@Injectable()
export class StudyPlanService {
  private readonly logger = new Logger(StudyPlanService.name);
  private readonly activeGenerations = new Map<string, Promise<any>>();

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
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(BatchSubjectTeacher)
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(LectureProgress)
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(AiStudySession)
    private readonly aiStudySessionRepo: Repository<AiStudySession>,
    @InjectRepository(Chapter)
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(TopicResource)
    private readonly topicResourceRepo: Repository<TopicResource>,
    private readonly dataSource: DataSource,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: NotificationService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  async generatePlan(
    userId: string,
    tenantId: string,
    force: boolean,
    preferences?: GenerateStudyPlanDto,
    batchId?: string,
  ) {
    const resolvedBatchId = batchId ?? preferences?.batchId ?? null;
    const student = await this.getStudentByUserId(userId, tenantId);
    const choices = await this.resolvePlanGenerationChoices(student, preferences);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId);

    // Fetch enrollment early to use in concurrency checks and downstream logic
    const enrollmentWhere = resolvedBatchId
      ? { studentId: student.id, batchId: resolvedBatchId, status: EnrollmentStatus.ACTIVE }
      : { studentId: student.id, status: EnrollmentStatus.ACTIVE };
    const enrollment = await this.enrollmentRepo.findOne({
      where: enrollmentWhere,
      relations: ['batch'],
    }).catch(() => null);

    // Return existing plan if still valid and not forced
    const planWhere = resolvedBatchId
      ? { studentId: student.id, batchId: resolvedBatchId }
      : { studentId: student.id, batchId: IsNull() };
    const existing = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (existing && !force && existing.validUntil && new Date(existing.validUntil) > new Date()) {
      return this.getPlanWithItems(existing.id, effectiveTenantId);
    }

    // Prevent concurrent duplicate generation for the same student+batch
    const lockKey = resolvedBatchId ? `${student.id}:${resolvedBatchId}` : student.id;
    if (this.activeGenerations.has(lockKey)) {
      return this.activeGenerations.get(lockKey);
    }

    const generationPromise = (async () => {
      try {
        return await this.doGeneratePlan(userId, effectiveTenantId, student, force, enrollment, choices, resolvedBatchId);
      } finally {
        this.activeGenerations.delete(lockKey);
      }
    })();

    this.activeGenerations.set(lockKey, generationPromise);
    return generationPromise;
  }

  private async doGeneratePlan(
    userId: string,
    effectiveTenantId: string,
    student: Student,
    force: boolean,
    enrollment: Enrollment | null,
    choices: PlanGenerationChoices,
    batchId: string | null = null,
  ) {
    const effectiveBatchId = batchId ?? enrollment?.batchId ?? null;
    const effectiveExamTarget = choices.targetExam;
    const { planned: previousPlannedTopicIds, completed: previouslyCompletedTopicIds } = await this.getPreviousPlanContext(student.id, force);
    const completedTopicIds = await this.getCompletedTopicIds(student.id);

    const topicWhere = effectiveBatchId
      ? { tenantId: effectiveTenantId, isActive: true, chapter: { subject: { batchId: effectiveBatchId } } }
      : { tenantId: effectiveTenantId, isActive: true };

    const [monthlyWeakTopics, availableTopics] = await Promise.all([
      this.computeWeakTopics(student.id, effectiveTenantId, effectiveBatchId ?? undefined),
      this.topicRepo.find({
        where: topicWhere as any,
        relations: ['chapter', 'chapter.subject'],
        order: { sortOrder: 'ASC' },
      }),
    ]);

    // Attach topic names using a separate query with tenantId (relations JOIN can miss tenant-scoped rows)
    const topicIds = [...new Set(monthlyWeakTopics.map((wt) => wt.topicId).filter(Boolean))];
    const topicsForWeak = topicIds.length
      ? await this.topicRepo.find({ where: { id: In(topicIds), tenantId: effectiveTenantId }, relations: ['chapter', 'chapter.subject'] })
      : [];
    const topicMap = new Map(topicsForWeak.map((t) => [t.id, t]));
    monthlyWeakTopics.forEach((wt) => { wt.topic = topicMap.get(wt.topicId) ?? null as any; });
    const weakTopics = monthlyWeakTopics.length
      ? monthlyWeakTopics
      : await this.weakTopicRepo.find({ where: { studentId: student.id } });

    // Strictly use target-exam subjects for daily monthly plan generation.
    const subjectRotation = this.defaultSubjectsForExamTarget(effectiveExamTarget);

    const currentMonth = this.todayIst().slice(0, 7);
    const cacheKey = this.buildMonthlyCacheKey(
      effectiveTenantId,
      choices.targetExam,
      choices.examYear,
      choices.currentClass,
      choices.dailyStudyHours,
      subjectRotation,
      currentMonth,
    );
    // For explicit regenerate, always rebuild a fresh plan and overwrite cache.
    let items = force ? null : await this.cacheManager.get<RawPlanItem[]>(cacheKey);
    if (!items?.length || force) {
      items = this.buildMonthlySubjectBalancedPlan(
        choices,
        subjectRotation,
        availableTopics,
        weakTopics,
        previousPlannedTopicIds,
        completedTopicIds,
        previouslyCompletedTopicIds,
      );
      await this.cacheManager.set(cacheKey, items, 60 * 60 * 24 * 14);
    }

    // ── Persist ─────────────────────────────────────────────────────────────
    const planDays = 30;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + planDays);

    const finalItems = (items || []).filter((item) => !!item.date && !!item.type);

    const plan = await this.studyPlanRepo.manager.transaction(async (manager) => {
      const planWhere = effectiveBatchId
        ? { studentId: student.id, batchId: effectiveBatchId }
        : { studentId: student.id, batchId: IsNull() };
      
      let planRecord = await manager.findOne(StudyPlan, { 
        where: planWhere as any,
        withDeleted: true 
      });

      if (planRecord) {
        // Update existing
        planRecord.generatedAt = new Date();
        planRecord.validUntil = validUntil;
        planRecord.aiVersion = MONTHLY_PLAN_CACHE_VERSION;
        planRecord.deletedAt = null;
        await manager.save(planRecord);
      } else {
        // Create new
        planRecord = manager.create(StudyPlan, {
          studentId: student.id,
          batchId: effectiveBatchId,
          tenantId: effectiveTenantId,
          generatedAt: new Date(),
          validUntil,
          aiVersion: MONTHLY_PLAN_CACHE_VERSION,
        });
        await manager.save(planRecord);
      }

      await manager.delete(PlanItem, { studyPlanId: planRecord.id });

      const planItems = finalItems.map((item, i) =>
          manager.create(PlanItem, {
            studyPlanId: planRecord.id,
            scheduledDate: item.date,
            type: this.mapPlanItemType(item.type),
            refId: item.refId ?? null,
            title: item.title || `${item.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Session`,
            estimatedMinutes: item.estimatedMinutes ?? 30,
            sortOrder: i,
            status: PlanItemStatus.PENDING,
          }),
        );

      if (planItems.length) await manager.save(planItems);
      return planRecord;
    });

    // ── Spaced repetition: add revision tasks for topics passed 7/21/45 days ago ──
    await this.addRevisionTasks(student.id, effectiveTenantId).catch(() => {});

    if (force) {
      await this.notificationService.send({
        userId,
        tenantId: effectiveTenantId,
        title: 'Your study plan has been updated!',
        body: '📅 Your personalised study plan has been refreshed based on your latest progress.',
        channels: ['push', 'in_app'],
        refType: 'study_plan_regenerated',
        refId: plan.id,
      });
    }

    return this.getPlanWithItems(plan.id, effectiveTenantId);
  }

  async clearCurrentPlan(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    const existing = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (!existing) {
      return { message: 'No existing study plan to clear.' };
    }

    await this.studyPlanRepo.manager.transaction(async (manager) => {
      await manager.delete(PlanItem, { studyPlanId: existing.id });
      await manager.delete(StudyPlan, { id: existing.id });
    });

    return { message: 'Previous study plan removed successfully.' };
  }

  async getToday(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    let plan = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (!plan) return [];

    const today = this.todayIst();
    const items = await this.planItemRepo.find({
      where: { studyPlanId: plan.id, scheduledDate: today },
      order: { sortOrder: 'ASC' },
    });

    return this.resolvePlanItems(items, effectiveTenantId, student.id);
  }

  async getRange(userId: string, tenantId: string, query: StudyPlanRangeQueryDto) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId);
    const planWhere = query.batchId
      ? { studentId: student.id, batchId: query.batchId }
      : { studentId: student.id, batchId: IsNull() };
    let plan = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });

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

    const resolved = await this.resolvePlanItems(items, effectiveTenantId, student.id);
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

  async completeByReference(
    studentId: string,
    tenantId: string,
    refId: string,
    type: PlanItemType,
  ): Promise<boolean> {
    if (!refId) return false;
    const plan = await this.studyPlanRepo.findOne({
      where: { studentId },
      order: { createdAt: 'DESC' },
      withDeleted: true,
    });
    if (!plan) return false;

    const item = await this.planItemRepo.findOne({
      where: {
        studyPlanId: plan.id,
        refId,
        type,
        status: PlanItemStatus.PENDING,
      },
      order: { scheduledDate: 'ASC', sortOrder: 'ASC' },
    });
    if (!item) return false;

    item.status = PlanItemStatus.COMPLETED;
    item.completedAt = new Date();
    await this.planItemRepo.save(item);
    return true;
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
    // Intentionally disabled: study plans are fully manual
    // and should only be generated/regenerated by explicit student action.
    return;
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
      where: { studentId, status: EnrollmentStatus.ACTIVE },
    }).catch(() => null);
    if (!enrollment) return;

    const studyPlan = await this.studyPlanRepo.findOne({ where: { studentId }, withDeleted: true });
    if (!studyPlan) return;

    const refId = nextTopic.id;
    const itemType = PlanItemType.PRACTICE;

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
        title: `Practice + Notes: ${nextTopic.name}`,
        estimatedMinutes: nextTopic.estimatedStudyMinutes || 45,
        sortOrder: 0,
        status: PlanItemStatus.PENDING,
      }),
    );
  }

  // ─── Spaced repetition: add revision tasks ────────────────────────────────

  async addRevisionTasks(studentId: string, tenantId: string) {
    const passedTopics = await this.topicProgressRepo.find({
      where: { studentId, status: TopicStatus.COMPLETED },
      relations: ['topic'],
    });
    if (!passedTopics.length) return;

    const studyPlan = await this.studyPlanRepo.findOne({ where: { studentId }, withDeleted: true });
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

  async getNextAction(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    const plan = await this.studyPlanRepo.findOne({ where: planWhere as any });
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
      const resolved = await this.resolvePlanItems([item], effectiveTenantId, student.id);
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

  // ─── Structured spaced-revision session ────────────────────────────────────

  async startRevisionSession(
    userId: string,
    tenantId: string,
    topicId: string,
    accuracy: number,
    intervalDays: 1 | 3 | 7 | 21,
  ) {
    const topic = await this.topicRepo.findOne({
      where: { id: topicId },
      relations: ['chapter', 'chapter.subject'],
    });
    if (!topic) throw new NotFoundException('Topic not found');

    const sessionType =
      intervalDays === 1 ? 'INTENSIVE' :
      intervalDays === 3 ? 'STANDARD'  :
      intervalDays === 7 ? 'QUICK'     : 'FLASH';

    const estimatedMinutes = intervalDays === 1 ? 20 : intervalDays === 3 ? 15 : intervalDays === 7 ? 10 : 5;
    const targetAccuracy   = Math.min(accuracy + 15, 85);
    const drillCount       = sessionType === 'INTENSIVE' ? 10 : sessionType === 'STANDARD' ? 7 : sessionType === 'QUICK' ? 5 : 3;
    const conceptCount     = sessionType === 'FLASH' ? 0 : 2;
    const baseDifficulty   = accuracy < 40 ? 'easy' : accuracy < 65 ? 'medium' : 'hard';

    const student = await this.getStudentByUserId(userId, tenantId);
    const existingSession = await this.aiStudySessionRepo.findOne({
      where: { studentId: student.id, topicId },
      order: { createdAt: 'DESC' } as any,
    });

    const conceptQuestions = (existingSession?.practiceQuestions ?? [])
      .slice(0, conceptCount)
      .map(q => ({ question: q.question, answer: q.answer, explanation: q.explanation ?? '' }));

    const keyConcepts = existingSession?.keyConcepts ?? [];

    let drillQuestions: Array<{
      question: string; options: string[]; correctAnswer: string;
      explanation: string; difficulty: string;
    }> = [];

    try {
      const generated = await this.aiBridgeService.generateQuestionsFromTopic(
        {
          topicId,
          topicName: topic.name,
          count: drillCount,
          difficulty: baseDifficulty,
          type: 'mcq_single',
          subject: topic.chapter?.subject?.name,
          chapter: topic.chapter?.name,
        },
        tenantId,
      );
      if (Array.isArray(generated)) {
        drillQuestions = generated.map(q => {
          const rawOpts: any[] = q.options ?? q.choices ?? [];
          const options = rawOpts.map((o: any) =>
            typeof o === 'string' ? o : (o.content ?? o.text ?? o.value ?? String(o)),
          );
          return {
            question: q.question ?? q.questionText ?? '',
            options,
            correctAnswer: q.answer ?? q.correctAnswer ?? '',
            explanation: q.explanation ?? '',
            difficulty: q.difficulty ?? baseDifficulty,
          };
        });
      }
    } catch (e) {
      this.logger.warn(`[RevisionSession] Question generation failed: ${(e as Error).message}`);
    }

    const recallPrompts = keyConcepts.length > 0
      ? keyConcepts.slice(0, 3).map((c: string) => `Can you recall: "${c}"?`)
      : [
          `What are the 3 most important concepts in "${topic.name}"?`,
          `Write down 1 formula or definition you remember from this topic.`,
          `What part of "${topic.name}" did you find most challenging?`,
        ];

    return {
      sessionType,
      estimatedMinutes,
      targetAccuracy,
      previousAccuracy: accuracy,
      topicName: topic.name,
      subjectName: topic.chapter?.subject?.name ?? '',
      chapterName: topic.chapter?.name ?? '',
      recallPrompts,
      conceptQuestions,
      drillQuestions,
    };
  }

  // ─── Course list with plan status ───────────────────────────────────────────

  async getCoursesWithPlanStatus(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);

    const enrollments = await this.enrollmentRepo.find({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
    });

    const batchIds = enrollments.map((e) => e.batchId).filter(Boolean);
    const plans = batchIds.length
      ? await this.studyPlanRepo.find({ where: { studentId: student.id, batchId: In(batchIds) } })
      : [];
    const planByBatch = new Map(plans.map((p) => [p.batchId, p]));

    return enrollments
      .filter((e) => e.batch)
      .map((e) => {
        const plan = planByBatch.get(e.batchId) ?? null;
        return {
          batchId: e.batchId,
          batchName: e.batch!.name,
          examTarget: e.batch!.examTarget ?? null,
          thumbnailUrl: (e.batch as any).thumbnailUrl ?? null,
          enrolledAt: e.enrolledAt,
          plan: plan
            ? {
                id: plan.id,
                generatedAt: plan.generatedAt,
                validUntil: plan.validUntil,
                isValid: plan.validUntil ? new Date(plan.validUntil) > new Date() : false,
              }
            : null,
        };
      });
  }

  // ─── Auto-add newly created topic to enrolled students' plans ────────────────

  async onTopicCreated(topicId: string, batchId: string | null, tenantId: string) {
    if (!batchId) return;

    const topic = await this.topicRepo.findOne({
      where: { id: topicId, tenantId },
      relations: ['chapter', 'chapter.subject'],
    });
    if (!topic) return;

    const enrollments = await this.enrollmentRepo.find({
      where: { batchId, status: EnrollmentStatus.ACTIVE },
    });
    if (!enrollments.length) return;

    const studentIds = enrollments.map((e) => e.studentId);
    const plans = await this.studyPlanRepo.find({
      where: { studentId: In(studentIds), batchId },
    });

    for (const plan of plans) {
      const alreadyIn = await this.planItemRepo.findOne({
        where: {
          studyPlanId: plan.id,
          refId: topicId,
          type: PlanItemType.PRACTICE,
          status: Not(PlanItemStatus.SKIPPED),
        },
      });
      if (alreadyIn) continue;

      const lastTask = await this.planItemRepo.findOne({
        where: { studyPlanId: plan.id },
        order: { scheduledDate: 'DESC', sortOrder: 'DESC' },
      });
      const scheduledDate = this.addDays(lastTask?.scheduledDate ?? this.todayIst(), 1);

      await this.planItemRepo.save(
        this.planItemRepo.create({
          studyPlanId: plan.id,
          scheduledDate,
          type: PlanItemType.PRACTICE,
          refId: topicId,
          title: `Study: ${topic.name}`,
          estimatedMinutes: topic.estimatedStudyMinutes || 45,
          sortOrder: 0,
          status: PlanItemStatus.PENDING,
        }),
      );
    }
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
    allTopics: Topic[],
    daysToExam: number,
    subjects: string[],
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

    // ── Index lectures by topicId ─────────────────────────────────────────────
    const lectureByTopic = new Map<string, Lecture[]>();
    for (const lec of lectures) {
      if (!lec.topicId) continue;
      if (!lectureByTopic.has(lec.topicId)) lectureByTopic.set(lec.topicId, []);
      lectureByTopic.get(lec.topicId)!.push(lec);
    }

    // ── Index topics by subject for real-data rotation (no placeholders) ─────
    const topicsBySubject = new Map<string, Topic[]>();
    for (const t of allTopics) {
      const sName = t.chapter?.subject?.name;
      if (!sName) continue;
      if (!topicsBySubject.has(sName)) topicsBySubject.set(sName, []);
      topicsBySubject.get(sName)!.push(t);
    }
    const topicCursorBySubject = new Map<string, number>();

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

      const subjectPool = topicsBySubject.get(subject) ?? [];
      const cursor = topicCursorBySubject.get(subject) ?? 0;
      const subjectTopic = subjectPool.length ? subjectPool[cursor % subjectPool.length] : null;
      if (subjectPool.length) topicCursorBySubject.set(subject, cursor + 1);
      const topicName = wt?.topic?.name ?? subjectTopic?.name ?? `${subject} Practice`;
      const effectiveTopicId = wt?.topicId ?? subjectTopic?.id ?? null;

      // Find a real lecture for this weak topic
      const lecture = effectiveTopicId ? (lectureByTopic.get(effectiveTopicId)?.[0] ?? null) : null;
      const effectiveWeakTopic = wt ?? (effectiveTopicId
        ? ({
            topicId: effectiveTopicId,
            topic: subjectTopic ?? null,
          } as unknown as WeakTopic)
        : null);

      if (phase === 'foundation') {
        // Foundation: Lecture → Practice → Light revision
        this.addFoundationDay(items, dateStr, dailyMinutes, subject, topicName, lecture, effectiveWeakTopic, weakQueue, weakIdx);
      } else if (phase === 'consolidation') {
        // Consolidation: Revision → Practice → Doubt
        this.addConsolidationDay(items, dateStr, dailyMinutes, subject, topicName, effectiveWeakTopic);
      } else {
        // Testing: Speed drills → targeted practice
        this.addTestingDay(items, dateStr, dailyMinutes, subject, topicName, effectiveWeakTopic);
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

    // Notes slot (AI self-study), no YouTube task.
    items.push({
      date,
      type: 'revision',
      title: `AI Notes Deep Dive: ${topicName} (${subject})`,
      refId: wt?.topicId ?? lecture?.topicId ?? null,
      estimatedMinutes: lectureMinutes,
    });

    // Practice slot
    items.push({
      date,
      type: 'practice',
      title: `Practice Questions: ${topicName}`,
      estimatedMinutes: practiceMinutes,
    });

    // Extra slot (if enough time): practice booster, not another notes item.
    if (revisionMinutes >= 20) {
      const prevTopic = weakQueue.length > 1 ? weakQueue[(weakIdx - 2 + weakQueue.length) % weakQueue.length] : wt;
      items.push({
        date,
        type: 'practice',
        refId: prevTopic?.topicId ?? wt?.topicId ?? null,
        title: `Practice Booster: ${prevTopic?.topic?.name ?? topicName}`,
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
      refId: wt?.topicId ?? null,
      title: `AI Notes Deep Revision: ${topicName}`,
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
      refId: wt?.topicId ?? null,
      title: `Flash Notes Revision: ${topicName}`,
      estimatedMinutes: flashMinutes,
    });
  }

  /**
   * Build weak topics from the student's test history.
   * This powers plan generation and dashboard recommendations.
   */
  private async computeWeakTopics(studentId: string, tenantId: string, batchId?: string): Promise<WeakTopic[]> {
    const params: any[] = [studentId, tenantId];
    const batchFilter = batchId ? `AND ts.mock_test_id IN (SELECT id FROM mock_tests WHERE batch_id = $3)` : '';
    if (batchId) params.push(batchId);

    const rows = await this.dataSource.query(
      `
        SELECT
          q.topic_id AS "topicId",
          COUNT(*)::int AS "attemptCount",
          SUM(CASE WHEN qa.is_correct = false THEN 1 ELSE 0 END)::int AS "wrongCount",
          AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END)::float AS "accuracy",
          MAX(qa.answered_at) AS "lastAttemptedAt"
        FROM question_attempts qa
        INNER JOIN test_sessions ts ON ts.id = qa.test_session_id
        INNER JOIN questions q ON q.id = qa.question_id
        WHERE qa.student_id = $1
          AND qa.tenant_id = $2
          AND qa.deleted_at IS NULL
          AND ts.status IN ('submitted', 'auto_submitted')
          ${batchFilter}
        GROUP BY q.topic_id
        HAVING COUNT(*) >= 3
        ORDER BY
          (SUM(CASE WHEN qa.is_correct = false THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) DESC,
          COUNT(*) DESC
        LIMIT 12
      `,
      params,
    );

    return rows.map((row: any) => {
      const wrongCount = Number(row.wrongCount || 0);
      const severity =
        wrongCount >= 10 ? WeakTopicSeverity.CRITICAL :
        wrongCount >= 6 ? WeakTopicSeverity.HIGH :
        wrongCount >= 3 ? WeakTopicSeverity.MEDIUM :
        WeakTopicSeverity.LOW;

      return this.weakTopicRepo.create({
        studentId,
        topicId: row.topicId,
        severity,
        accuracy: Number(Number(row.accuracy || 0).toFixed(2)),
        wrongCount,
        lastAttemptedAt: row.lastAttemptedAt ? new Date(row.lastAttemptedAt) : null,
        // Not using these for monthly plan logic, keep safe defaults.
        doubtCount: 0,
        rewindCount: 0,
      });
    });
  }

  /** Aggregate test data that the AI service can use for better personalization. */
  private async computeTestInsights(studentId: string, tenantId: string, batchId?: string) {
    const params: any[] = [studentId, tenantId];
    const batchJoinFilter = batchId ? `AND mt.batch_id = $3` : '';
    if (batchId) params.push(batchId);

    const [summaryRows, subjectRows] = await Promise.all([
      this.dataSource.query(
        `
          SELECT
            COUNT(ts.id)::int AS "testsTaken",
            COALESCE(AVG(COALESCE(ts.total_score, 0)), 0)::float AS "avgScore",
            COALESCE(AVG(
              CASE
                WHEN (COALESCE(ts.correct_count,0) + COALESCE(ts.wrong_count,0)) > 0
                THEN (COALESCE(ts.correct_count,0)::float * 100.0) /
                     NULLIF((COALESCE(ts.correct_count,0) + COALESCE(ts.wrong_count,0)), 0)
                ELSE 0
              END
            ), 0)::float AS "avgAccuracy"
          FROM test_sessions ts
          LEFT JOIN mock_tests mt ON mt.id = ts.mock_test_id
          WHERE ts.student_id = $1
            AND ts.tenant_id = $2
            AND ts.status IN ('submitted', 'auto_submitted')
            ${batchJoinFilter}
        `,
        params,
      ),
      this.dataSource.query(
        `
          SELECT
            s.name AS "subjectName",
            AVG(CASE WHEN qa.is_correct = true THEN 100 ELSE 0 END)::float AS "accuracy",
            COUNT(*)::int AS "attemptCount"
          FROM question_attempts qa
          INNER JOIN test_sessions ts ON ts.id = qa.test_session_id
          INNER JOIN questions q ON q.id = qa.question_id
          INNER JOIN topics t ON t.id = q.topic_id
          INNER JOIN chapters c ON c.id = t.chapter_id
          INNER JOIN subjects s ON s.id = c.subject_id
          LEFT JOIN mock_tests mt ON mt.id = ts.mock_test_id
          WHERE qa.student_id = $1
            AND qa.tenant_id = $2
            AND ts.status IN ('submitted', 'auto_submitted')
            ${batchJoinFilter}
          GROUP BY s.name
          ORDER BY "accuracy" ASC
        `,
        params,
      ),
    ]);

    return {
      periodDays: 365,
      testsTaken: Number(summaryRows?.[0]?.testsTaken ?? 0),
      avgScore: Number(Number(summaryRows?.[0]?.avgScore ?? 0).toFixed(2)),
      avgAccuracy: Number(Number(summaryRows?.[0]?.avgAccuracy ?? 0).toFixed(2)),
      weakSubjects: (subjectRows || []).slice(0, 3).map((r: any) => ({
        subjectName: String(r.subjectName || 'Unknown'),
        accuracy: Number(Number(r.accuracy || 0).toFixed(2)),
        attemptCount: Number(r.attemptCount || 0),
      })),
    };
  }

  // ─── Helper methods ──────────────────────────────────────────────────────────

  private async resolvePlanGenerationChoices(
    student: Student,
    preferences?: GenerateStudyPlanDto,
  ): Promise<PlanGenerationChoices> {
    const existingPlan = await this.studyPlanRepo.findOne({
      where: { studentId: student.id },
      withDeleted: true,
    });
    const isFirstGenerate = !existingPlan;

    const targetExam = (preferences?.targetExam ?? student.examTarget) as string | undefined;
    const examYear = String(preferences?.examYear ?? student.examYear ?? this.defaultExamYear());
    const currentClass = String(preferences?.currentClass ?? student.class ?? StudentClass.CLASS_11);
    const dailyStudyHours = Number(preferences?.dailyStudyHours ?? student.dailyStudyHours ?? 4);

    if (isFirstGenerate) {
      const missingFields: string[] = [];
      if (!preferences?.targetExam) missingFields.push('targetExam');
      if (!preferences?.examYear) missingFields.push('examYear');
      if (!preferences?.currentClass) missingFields.push('currentClass');
      if (typeof preferences?.dailyStudyHours !== 'number') missingFields.push('dailyStudyHours');
      if (missingFields.length) {
        throw new BadRequestException({
          message: 'First-time generation requires popup choices.',
          requiredFields: ['targetExam', 'examYear', 'currentClass', 'dailyStudyHours'],
          missingFields,
        });
      }
    }

    if (!targetExam) {
      throw new BadRequestException({
        message: 'targetExam is required to generate study plan subjects.',
        requiredFields: ['targetExam'],
      });
    }

    // Persist latest choices so monthly regenerate can reuse them.
    student.examTarget = targetExam as any;
    student.examYear = examYear as any;
    student.class = currentClass as any;
    student.dailyStudyHours = dailyStudyHours;
    await this.studentRepo.save(student);

    return {
      targetExam,
      examYear,
      currentClass,
      dailyStudyHours,
    };
  }

  private buildMonthlyCacheKey(
    tenantId: string,
    examTarget: string,
    examYear: string,
    currentClass: string,
    dailyStudyHours: number,
    subjects: string[],
    monthKey: string,
  ) {
    const normalizedSubjects = [...subjects].map((s) => s.toLowerCase().trim()).sort().join(',');
    return [
      'study-plan',
      MONTHLY_PLAN_CACHE_VERSION,
      tenantId,
      examTarget,
      examYear,
      currentClass,
      String(dailyStudyHours),
      normalizedSubjects,
      monthKey,
    ].join(':');
  }

  private buildMonthlySubjectBalancedPlan(
    choices: PlanGenerationChoices,
    subjects: string[],
    topics: Topic[],
    weakTopics: WeakTopic[],
    previousPlannedTopicIds: Set<string>,
    completedTopicIds: Set<string>,
    previouslyCompletedTopicIds: Set<string> = new Set(),
  ): RawPlanItem[] {
    const today = this.todayIst();
    const totalDays = 30;
    const normalizedSubjects = subjects.filter(Boolean).length
      ? subjects.filter(Boolean)
      : this.defaultSubjectsForExamTarget(choices.targetExam);
    
    const topicsBySubject = new Map<string, Topic[]>();
    for (const topic of topics) {
      const subjectName = String(topic.chapter?.subject?.name || '').trim();
      if (!subjectName) continue;
      if (!topicsBySubject.has(subjectName)) topicsBySubject.set(subjectName, []);
      topicsBySubject.get(subjectName)!.push(topic);
    }

    const perSubjectCursor = new Map<string, number>();
    const dailyStudyMinutes = (choices.dailyStudyHours || 4) * 60;
    const examDate = this.deriveExamDate(choices.examYear as any);
    const daysToExam = Math.max(30, Math.floor((examDate.getTime() - new Date().getTime()) / 86400000));
    
    // Pacing Logic:
    // 1. Calculate how many topics we MUST cover per day to finish on time.
    const minimumTopicsPerDay = Math.ceil(topics.length / daysToExam);
    
    // 2. Calculate how many topics we CAN cover per day based on hours.
    const capacityTopicsPerDay = Math.max(1, Math.floor(dailyStudyMinutes / 50));
    
    // 3. Set target topics per day.
    let targetTopicsPerDay = Math.max(minimumTopicsPerDay, capacityTopicsPerDay);
    targetTopicsPerDay = Math.min(targetTopicsPerDay, Math.max(normalizedSubjects.length * 2, 8)); 

    const items: RawPlanItem[] = [];
    const subjectsWithPending = normalizedSubjects.filter(s => {
      const sTopics = topicsBySubject.get(s) || [];
      return sTopics.some(t => !completedTopicIds.has(t.id));
    });

    const isGlobalSyllabusCompleted = subjectsWithPending.length === 0;

    for (let day = 0; day < totalDays; day++) {
      const date = this.addDays(today, day);
      
      // Determine which subjects to focus on today. 
      // If we haven't finished the syllabus, we only focus on subjects that have pending topics.
      const activeSubjects = isGlobalSyllabusCompleted ? normalizedSubjects : subjectsWithPending;
      
      // Redistribute topics among active subjects
      const baseTopicsPerSubject = Math.floor(targetTopicsPerDay / activeSubjects.length);
      const extraTopics = targetTopicsPerDay % activeSubjects.length;
      
      activeSubjects.forEach((subject, index) => {
        const assignedTopicCount = baseTopicsPerSubject + (index < extraTopics ? 1 : 0);
        const subjectTopics = topicsBySubject.get(subject) || [];
        const prioritized = this.prioritizeExamReadyTopics(
          choices.targetExam,
          subjectTopics,
          previousPlannedTopicIds,
          completedTopicIds,
          weakTopics,
          previouslyCompletedTopicIds,
        );

        // Filter: If we are NOT in global revision mode, ONLY pick pending topics.
        const pool = isGlobalSyllabusCompleted 
           ? prioritized 
           : prioritized.filter(t => !completedTopicIds.has(t.id));

        const unplannedInSession = pool.filter(t => !items.some(it => it.refId === t.id));

        for (let t = 0; t < assignedTopicCount; t++) {
          const cursor = perSubjectCursor.get(subject) ?? 0;
          const topic = unplannedInSession.length ? unplannedInSession[cursor % unplannedInSession.length] : null;

          if (topic) perSubjectCursor.set(subject, cursor + 1);

          const minutesPerSlot = Math.max(20, Math.floor(dailyStudyMinutes / (targetTopicsPerDay * 2)));

          if (isGlobalSyllabusCompleted) {
            // Intensive Revision Mode (Only if EVERYTHING is done)
            items.push({
              date,
              type: 'revision',
              title: `Intensive Revision: ${topic?.name ?? subject} (${subject})`,
              refId: topic?.id ?? null,
              subjectName: subject,
              estimatedMinutes: minutesPerSlot * 2,
            });
          } else if (topic) {
            // Standard Study Mode: Notes + Practice for PENDING topics
            items.push({
              date,
              type: 'revision',
              title: `Study & AI Notes: ${topic.name}`,
              refId: topic.id,
              subjectName: subject,
              estimatedMinutes: minutesPerSlot,
            });
            items.push({
              date,
              type: 'practice',
              title: `Practice Questions: ${topic.name}`,
              refId: topic.id,
              subjectName: subject,
              estimatedMinutes: minutesPerSlot,
            });
          }
        }
      });
    }

    return this.removeDuplicatePlanItems(items);
  }

  private prioritizeUnplannedTopics(subjectTopics: Topic[], previouslyPlanned: Set<string>): Topic[] {
    if (!subjectTopics.length) return subjectTopics;
    const unplanned = subjectTopics.filter((t) => !previouslyPlanned.has(t.id));
    const planned = subjectTopics.filter((t) => previouslyPlanned.has(t.id));
    return unplanned.length ? [...unplanned, ...planned] : subjectTopics;
  }

  private prioritizeExamReadyTopics(
    targetExam: string,
    subjectTopics: Topic[],
    previouslyPlanned: Set<string>,
    completedTopicIds: Set<string>,
    weakTopics: WeakTopic[],
    previouslyCompletedTopicIds: Set<string> = new Set(),
  ): Topic[] {
    if (!subjectTopics.length) return subjectTopics;

    const weakMap = new Map(weakTopics.map((wt) => [wt.topicId, wt.severity]));

    const getSeverityScore = (severity?: WeakTopicSeverity) => {
      switch (severity) {
        case WeakTopicSeverity.CRITICAL: return 4;
        case WeakTopicSeverity.HIGH:     return 3;
        case WeakTopicSeverity.MEDIUM:   return 2;
        case WeakTopicSeverity.LOW:      return 1;
        default:                         return 0;
      }
    };

    const pending = subjectTopics.filter((t) => !completedTopicIds.has(t.id) && !previouslyCompletedTopicIds.has(t.id));
    const completed = subjectTopics.filter((t) => completedTopicIds.has(t.id) || previouslyCompletedTopicIds.has(t.id));

    // 1. Pending Weak Topics (Highest Priority)
    const pendingWeak = pending
      .filter((t) => weakMap.has(t.id))
      .sort((a, b) => {
        const scoreA = getSeverityScore(weakMap.get(a.id));
        const scoreB = getSeverityScore(weakMap.get(b.id));
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });

    // 2. Pending Previously Planned but Incompleted Topics
    const pendingIncompleted = pending
      .filter((t) => previouslyPlanned.has(t.id) && !weakMap.has(t.id))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // 3. Pending New/Unplanned Topics
    const pendingNew = pending
      .filter((t) => !previouslyPlanned.has(t.id) && !weakMap.has(t.id))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // 4. Completed Topics (Revision Priority)
    const completedSorted = completed.sort((a, b) => {
      if (a.chapter?.sortOrder !== b.chapter?.sortOrder) {
        return (a.chapter?.sortOrder ?? 0) - (b.chapter?.sortOrder ?? 0);
      }
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    return [
      ...pendingWeak,
      ...pendingIncompleted,
      ...pendingNew.sort((a, b) => {
        if (a.chapter?.sortOrder !== b.chapter?.sortOrder) {
          return (a.chapter?.sortOrder ?? 0) - (b.chapter?.sortOrder ?? 0);
        }
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      }),
      ...completedSorted,
    ];
  }

  private async getPreviousPlanContext(studentId: string, force: boolean): Promise<{ planned: Set<string>; completed: Set<string> }> {
    if (!force) return { planned: new Set(), completed: new Set() };
    const existingPlan = await this.studyPlanRepo.findOne({
      where: { studentId },
      withDeleted: true,
    });
    if (!existingPlan) return { planned: new Set(), completed: new Set() };
    const previousItems = await this.planItemRepo.find({
      where: { studyPlanId: existingPlan.id },
      select: ['refId', 'type', 'status'],
    });

    const planned = new Set<string>();
    const completed = new Set<string>();

    for (const item of previousItems) {
      if (!item.refId) continue;
      if (item.type === PlanItemType.PRACTICE || item.type === PlanItemType.REVISION) {
        planned.add(item.refId);
        if (item.status === PlanItemStatus.COMPLETED) {
          completed.add(item.refId);
        }
      }
    }
    return { planned, completed };
  }

  private async getCompletedTopicIds(studentId: string): Promise<Set<string>> {
    const completed = await this.topicProgressRepo.find({
      where: { studentId, status: TopicStatus.COMPLETED },
      select: ['topicId'],
    });
    return new Set(completed.map((row) => row.topicId).filter(Boolean));
  }

  private async getOwnedItem(itemId: string, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const item = await this.planItemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Plan item ${itemId} not found`);

    const plan = await this.studyPlanRepo.findOne({
      where: { id: item.studyPlanId, studentId: student.id },
      withDeleted: true,
    });
    if (!plan) throw new ForbiddenException('You do not own this plan item');

    return { item, plan, student };
  }

  private async getPlanWithItems(planId: string, tenantId: string) {
    const plan = await this.studyPlanRepo.findOne({ where: { id: planId }, withDeleted: true });
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
    const topicIds = topics.map((t) => t.id);
    const topicResources = topicIds.length
      ? await this.topicResourceRepo.find({
          where: { tenantId, topicId: In(topicIds), isActive: true },
          order: { sortOrder: 'ASC', createdAt: 'ASC' },
        })
      : [];
    const resourcesByTopic = new Map<string, TopicResource[]>();
    for (const r of topicResources) {
      if (!resourcesByTopic.has(r.topicId)) resourcesByTopic.set(r.topicId, []);
      resourcesByTopic.get(r.topicId)!.push(r);
    }

    const progressByLecture = new Map<string, LectureProgress>(
      (lectureProgresses as LectureProgress[]).map((p) => [p.lectureId, p] as [string, LectureProgress]),
    );

    const pub = (item: PlanItem) => ({
      id: item.id,
      studyPlanId: item.studyPlanId,
      scheduledDate: item.scheduledDate,
      type: item.type,
      refId: item.refId,
      title: item.title,
      estimatedMinutes: item.estimatedMinutes,
      sortOrder: item.sortOrder,
      status: item.status,
      completedAt: item.completedAt,
    });

    return items.map((item) => {
      if (item.type === PlanItemType.LECTURE && item.refId) {
        const lec = lectures.find((l) => l.id === item.refId);
        const lp  = progressByLecture.get(item.refId);
        return {
          ...pub(item),
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
          ...pub(item),
          content: {
            mockTestId: mt?.id,
            questionCount: (mt?.questionIds as string[] | null)?.length ?? null,
            durationMinutes: mt?.durationMinutes ?? null,
          },
        };
      }
      if ((item.type === PlanItemType.PRACTICE || item.type === PlanItemType.REVISION) && item.refId) {
        const topic = topics.find((t) => t.id === item.refId);
        const resources = topic ? (resourcesByTopic.get(topic.id) ?? []) : [];
        const videoRes =
          resources.find((r) => r.type === ResourceType.VIDEO && (!!r.externalUrl || !!r.fileUrl)) ??
          resources.find((r) => r.type === ResourceType.LINK && (r.externalUrl || '').includes('youtu'));
        const notesRes =
          resources.find((r) => r.type === ResourceType.NOTES && (!!r.fileUrl || !!r.externalUrl)) ??
          resources.find((r) => r.type === ResourceType.PDF && (!!r.fileUrl || !!r.externalUrl));
        const titleLower = (item.title || '').toLowerCase();
        const isVideoTask = item.type === PlanItemType.REVISION && (titleLower.includes('youtube') || titleLower.includes('video'));
        const taskKind =
          item.type === PlanItemType.PRACTICE
            ? 'practice'
            : isVideoTask
              ? 'youtube_video'
              : 'ai_notes';
        return {
          ...pub(item),
          content: {
            topicId: topic?.id ?? item.refId,
            topicName: topic?.name ?? item.title,
            chapterName: topic?.chapter?.name ?? null,
            subjectName: topic?.chapter?.subject?.name ?? (item as any).subjectName ?? null,
            taskKind,
            videoTitle: videoRes?.title ?? null,
            videoUrl: videoRes?.externalUrl ?? videoRes?.fileUrl ?? null,
            notesTitle: notesRes?.title ?? null,
            notesUrl: notesRes?.fileUrl ?? notesRes?.externalUrl ?? null,
          },
        };
      }
      return {
        ...pub(item),
        content: {
          subjectName: (item as any).subjectName ?? null,
        },
      };
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
    const yearNum = Number.parseInt(String(examYear), 10);
    const fallbackYear = new Date().getUTCFullYear() + 1;
    const y = Number.isFinite(yearNum) && yearNum > 2000 ? yearNum : fallbackYear;
    return new Date(Date.UTC(y, 3, 30, 0, 0, 0, 0)); // Apr 30 (month is 0-based)
  }

  private defaultExamYear(): string {
    const y = new Date().getUTCFullYear() + 1;
    const allowed = new Set(Object.values(ExamYear).map((v) => String(v)));
    if (allowed.has(String(y))) return String(y);
    return String(ExamYear.Y2028);
  }

  private defaultSubjectsForExamTarget(examTarget?: string): string[] {
    const exam = String(examTarget || '').toLowerCase();
    if (exam === 'neet') return NEET_SUBJECTS;
    if (exam === 'both' || exam === 'foundation' || exam === 'other') return BOTH_SUBJECTS;
    // Handle 'jee', 'jee_mains', 'jee_advanced'
    return JEE_SUBJECTS;
  }

  private assignFallbackTopicRefs(items: RawPlanItem[], topics: Topic[], weakTopics: WeakTopic[]): RawPlanItem[] {
    if (!items.length) return items;
    const weakTopicIds = weakTopics.map((w) => w.topicId).filter(Boolean);
    const weakTopicSet = new Set(weakTopicIds);
    const fallbackWeakTopicId = weakTopicIds[0] ?? null;

    return items.map((item) => {
      if (!((item.type === 'practice' || item.type === 'revision') && !item.refId)) return item;

      const titleLower = String(item.title || '').toLowerCase();
      const matchedByName = topics.find((t) => titleLower.includes(String(t.name || '').toLowerCase()));
      if (matchedByName) return { ...item, refId: matchedByName.id };

      const subjectMatch = titleLower.match(/\(([^)]+)\)/)?.[1]?.trim().toLowerCase() ?? null;
      if (subjectMatch) {
        const topicBySubject = topics.find((t) =>
          String(t.chapter?.subject?.name || '').toLowerCase() === subjectMatch &&
          weakTopicSet.has(t.id),
        ) ?? topics.find((t) => String(t.chapter?.subject?.name || '').toLowerCase() === subjectMatch);
        if (topicBySubject) return { ...item, refId: topicBySubject.id };
      }

      return fallbackWeakTopicId ? { ...item, refId: fallbackWeakTopicId } : item;
    });
  }

  private ensureTodaySubjectCoverage(
    items: RawPlanItem[],
    subjects: string[],
    topics: Topic[],
    weakTopics: WeakTopic[],
  ): RawPlanItem[] {
    if (!subjects.length) return items;

    const today = this.todayIst();
    const normalizedSubjects = subjects.map((s) => String(s || '').trim()).filter(Boolean);
    const todayItems = items.filter((i) => i.date === today);
    const coveredToday = new Set(
      todayItems
        .map((i) => this.detectSubjectFromItem(i, topics))
        .filter((s): s is string => !!s),
    );

    const weakTopicSet = new Set(weakTopics.map((w) => w.topicId).filter(Boolean));
    const additions: RawPlanItem[] = [];
    for (const subject of normalizedSubjects) {
      const subjectTopics = topics.filter((t) => String(t.chapter?.subject?.name || '').trim() === subject);
      const topic =
        subjectTopics.find((t) => weakTopicSet.has(t.id)) ??
        subjectTopics[0] ??
        null;
      const subjectItems = todayItems.filter((i) => this.detectSubjectFromItem(i, topics) === subject);
      const hasNotes = subjectItems.some((i) => /notes|revision/i.test(String(i.title || '')) && !/youtube|video/i.test(String(i.title || '')));
      const hasPractice = subjectItems.some((i) => i.type === 'practice' || /practice/i.test(String(i.title || '')));

      if (!hasNotes) {
        additions.push({
          date: today,
          type: 'revision',
          title: `AI Notes + Quick Revision: ${topic?.name ?? subject} (${subject})`,
          refId: topic?.id,
          estimatedMinutes: 35,
        });
      }
      if (!hasPractice) {
        additions.push({
          date: today,
          type: 'practice',
          title: `Practice Questions: ${topic?.name ?? subject}`,
          refId: topic?.id,
          estimatedMinutes: Math.max(30, Math.min(45, topic?.estimatedStudyMinutes ?? 35)),
        });
      }
    }

    return additions.length ? [...items, ...additions] : items;
  }

  private detectSubjectFromItem(item: RawPlanItem, topics: Topic[]): string | null {
    if (item.refId) {
      const t = topics.find((x) => x.id === item.refId);
      if (t?.chapter?.subject?.name) return t.chapter.subject.name;
    }
    const title = String(item.title || '');
    const paren = title.match(/\(([^)]+)\)/)?.[1]?.trim();
    if (paren) return paren;
    const subjectGuess = topics.find((t) => title.toLowerCase().includes(String(t.chapter?.subject?.name || '').toLowerCase()));
    return subjectGuess?.chapter?.subject?.name ?? null;
  }

  private reorderTodayItems(items: RawPlanItem[], topics: Topic[]): RawPlanItem[] {
    const today = this.todayIst();
    const todayItems = items.filter((i) => i.date === today);
    const otherItems = items.filter((i) => i.date !== today);
    if (!todayItems.length) return items;

    const typePriority = (i: RawPlanItem): number => {
      const t = String(i.title || '').toLowerCase();
      if (t.includes('notes') || t.includes('revision')) return 0;
      if (i.type === 'practice' || t.includes('practice')) return 1;
      return 3;
    };

    const sorted = [...todayItems].sort((a, b) => {
      const sa = this.detectSubjectFromItem(a, topics) || 'zzzz';
      const sb = this.detectSubjectFromItem(b, topics) || 'zzzz';
      if (sa !== sb) return sa.localeCompare(sb);
      return typePriority(a) - typePriority(b);
    });

    return [...sorted, ...otherItems];
  }

  private removeDuplicatePlanItems(items: RawPlanItem[]): RawPlanItem[] {
    const seen = new Set<string>();
    const out: RawPlanItem[] = [];

    const normalizeTitle = (t: string) =>
      String(t || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .trim();

    for (const item of items) {
      const key = [
        item.date,
        item.type,
        item.refId ?? '',
        normalizeTitle(item.title || ''),
      ].join('|');

      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }

    return out;
  }

  private capTodayToOneNotesAndOnePracticePerSubject(items: RawPlanItem[], topics: Topic[]): RawPlanItem[] {
    const today = this.todayIst();
    const todayItems = items.filter((i) => i.date === today);
    const otherItems = items.filter((i) => i.date !== today);
    if (!todayItems.length) return items;

    const kept: RawPlanItem[] = [];
    const noteSeen = new Set<string>();
    const practiceSeen = new Set<string>();

    const isNotes = (i: RawPlanItem) => i.type === 'revision' || /notes|revision/i.test(String(i.title || ''));
    const isPractice = (i: RawPlanItem) => i.type === 'practice' || /practice/i.test(String(i.title || ''));

    for (const item of todayItems) {
      const subject = this.detectSubjectFromItem(item, topics) || 'General';

      if (isNotes(item)) {
        if (noteSeen.has(subject)) continue;
        noteSeen.add(subject);
        kept.push(item);
        continue;
      }

      if (isPractice(item)) {
        if (practiceSeen.has(subject)) continue;
        practiceSeen.add(subject);
        kept.push(item);
        continue;
      }

      kept.push(item);
    }

    return [...kept, ...otherItems];
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

  private normalizePlanItemType(type: string): string {
    const t = String(type || '').toLowerCase();
    if (t === 'lecture' || t === 'video' || t === 'youtube' || t === 'watch_video') return 'revision';
    if (t === 'notes' || t === 'note' || t === 'reading') return 'revision';
    return t || 'practice';
  }

  private normalizePlanItemTitle(title: string | null): string | null {
    const raw = String(title || '').trim();
    if (!raw) return null;
    if (/youtube|video|watch/i.test(raw)) {
      return raw
        .replace(/youtube\s*video\s*review[:\-]?\s*/i, 'AI Notes + Revision: ')
        .replace(/\b(youtube|video|watch)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return raw;
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
    const student =
      await this.studentRepo.findOne({ where: { userId, tenantId } }) ??
      await this.studentRepo.findOne({ where: { userId } });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  private async resolveEffectiveTenantId(student: Student, fallbackTenantId: string): Promise<string> {
    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    }).catch(() => null);
    return enrollment?.batch?.tenantId ?? student.tenantId ?? fallbackTenantId;
  }
}
