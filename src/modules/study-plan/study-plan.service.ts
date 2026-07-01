import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { Between, In, IsNull, MoreThan, Not, Repository } from 'typeorm';

import { NotificationService } from '../notification/notification.service';
import { AiBridgeService } from '../ai-bridge/ai-bridge.service';
import { WeakTopic, WeakTopicSeverity } from '../../database/entities/analytics.entity';
import { MockTest, MockTestType, TopicProgress, TopicStatus } from '../../database/entities/assessment.entity';
import { AiStudySession, Lecture, LectureProgress, PlanItem, PlanItemStatus, PlanItemType, StudyPlan } from '../../database/entities/learning.entity';
import { ExamYear, Student, StudentClass } from '../../database/entities/student.entity';
import { Chapter, ResourceType, Subject, Topic, TopicResource } from '../../database/entities/subject.entity';
import { Batch, BatchSubjectTeacher, Enrollment, EnrollmentStatus } from '../../database/entities/batch.entity';

import { StudyPlanRangeQueryDto, GenerateStudyPlanDto } from './dto/study-plan.dto';

// â”€â”€â”€ Internal types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type RawPlanItem = {
  date: string;
  type: string;
  title: string;
  refId?: string | null;
  estimatedMinutes?: number;
  subjectName?: string;
};

type PlanGenerationChoices = {
  targetExam: string;
  examYear: string;
  currentClass: string;
  dailyStudyHours: number;
};

@Injectable()
export class StudyPlanService {
  private readonly logger = new Logger(StudyPlanService.name);
  private readonly activeGenerations = new Map<string, Promise<any>>();

  constructor(
    @InjectRepository(StudyPlan, 'coaching')
    private readonly studyPlanRepo: Repository<StudyPlan>,
    @InjectRepository(PlanItem, 'coaching')
    private readonly planItemRepo: Repository<PlanItem>,
    @InjectRepository(Student, 'coaching')
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(WeakTopic, 'coaching')
    private readonly weakTopicRepo: Repository<WeakTopic>,
    @InjectRepository(TopicProgress, 'coaching')
    private readonly topicProgressRepo: Repository<TopicProgress>,
    @InjectRepository(Lecture, 'coaching')
    private readonly lectureRepo: Repository<Lecture>,
    @InjectRepository(MockTest, 'coaching')
    private readonly mockTestRepo: Repository<MockTest>,
    @InjectRepository(Topic, 'coaching')
    private readonly topicRepo: Repository<Topic>,
    @InjectRepository(Batch, 'coaching')
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Enrollment, 'coaching')
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(BatchSubjectTeacher, 'coaching')
    private readonly batchSubjectTeacherRepo: Repository<BatchSubjectTeacher>,
    @InjectRepository(LectureProgress, 'coaching')
    private readonly lectureProgressRepo: Repository<LectureProgress>,
    @InjectRepository(AiStudySession, 'coaching')
    private readonly aiStudySessionRepo: Repository<AiStudySession>,
    @InjectRepository(Chapter, 'coaching')
    private readonly chapterRepo: Repository<Chapter>,
    @InjectRepository(Subject, 'coaching')
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(TopicResource, 'coaching')
    private readonly topicResourceRepo: Repository<TopicResource>,
    @InjectDataSource('coaching')
    private readonly dataSource: DataSource,
    private readonly aiBridgeService: AiBridgeService,
    private readonly notificationService: NotificationService,
  ) {}

  // â”€â”€â”€ Plan Generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, resolvedBatchId);

    // Fast path: return existing valid plan when not forcing
    const planWhere = resolvedBatchId
      ? { studentId: student.id, batchId: resolvedBatchId }
      : { studentId: student.id, batchId: IsNull() };
    const existing = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (existing && !force && existing.validUntil && new Date(existing.validUntil) > new Date()) {
      this.logger.log(`[Plan] Returning valid plan for student=${student.id} batch=${resolvedBatchId ?? 'global'}`);
      return this.getPlanWithItems(existing.id, effectiveTenantId);
    }

    this.logger.log(`[Plan] Starting generation for student=${student.id} batch=${resolvedBatchId ?? 'global'} force=${force}`);

    // Prevent concurrent duplicate generation for the same student+batch
    const lockKey = resolvedBatchId ? `${student.id}:${resolvedBatchId}` : student.id;
    if (this.activeGenerations.has(lockKey)) {
      return this.activeGenerations.get(lockKey);
    }

    const promise = (async () => {
      try {
        return await this.doGeneratePlan(userId, effectiveTenantId, student, force, choices, resolvedBatchId);
      } finally {
        this.activeGenerations.delete(lockKey);
      }
    })();

    this.activeGenerations.set(lockKey, promise);
    return promise;
  }

  private async doGeneratePlan(
    userId: string,
    tenantId: string,
    student: Student,
    force: boolean,
    choices: PlanGenerationChoices,
    batchId: string | null,
  ) {
    const today = this.todayIst();

    // Resolve topics for this specific course
    const topics = await this.resolveTopicsForBatch(tenantId, batchId);
    this.logger.log(`[Plan] Resolved ${topics.length} topics for batch=${batchId ?? 'global'}`);

    if (!topics.length) {
      throw new BadRequestException(
        'No topics found for this course. Please ask your admin to add content.',
      );
    }

    // Get which topics this student has already completed
    const completedTopicIds = await this.getCompletedTopicIds(student.id);
    const pendingCount = topics.filter(t => !completedTopicIds.has(t.id)).length;
    const syllabusComplete = pendingCount === 0;

    // Build the 30-day plan (empty when syllabus is 100% done → intensive revision mode)
    const newItems = this.buildPlan(topics, completedTopicIds, choices, today);
    this.logger.log(
      `[Plan] Built ${newItems.length} items for student=${student.id} batch=${batchId ?? 'global'} ` +
      `(${pendingCount} pending, ${completedTopicIds.size} completed, syllabusComplete=${syllabusComplete})`,
    );

    const planDays = 30;
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + planDays);

    // Persist
    const plan = await this.studyPlanRepo.manager.transaction(async (manager) => {
      const planWhere = batchId
        ? { studentId: student.id, batchId }
        : { studentId: student.id, batchId: IsNull() };

      let planRecord = await manager.findOne(StudyPlan, { where: planWhere as any, withDeleted: true });

      if (planRecord) {
        // Preserve past items (backlog + history) — only wipe future pending items
        await manager
          .createQueryBuilder()
          .delete()
          .from(PlanItem)
          .where('study_plan_id = :planId', { planId: planRecord.id })
          .andWhere('scheduled_date >= :today', { today })
          .andWhere('status = :status', { status: PlanItemStatus.PENDING })
          .execute();

        planRecord.generatedAt = new Date();
        planRecord.validUntil = validUntil;
        planRecord.deletedAt = null;
        await manager.save(planRecord);
      } else {
        planRecord = manager.create(StudyPlan, {
          studentId: student.id,
          batchId,
          tenantId,
          generatedAt: new Date(),
          validUntil,
        });
        await manager.save(planRecord);
      }

      const planItems = newItems.map((item, i) =>
        manager.create(PlanItem, {
          studyPlanId: planRecord.id,
          scheduledDate: item.date,
          type: this.mapPlanItemType(item.type),
          refId: item.refId ?? null,
          title: item.title,
          estimatedMinutes: item.estimatedMinutes ?? 30,
          sortOrder: i,
          status: PlanItemStatus.PENDING,
        }),
      );
      if (planItems.length) await manager.save(planItems);
      return planRecord;
    });

    // Always attempt to populate spaced revision tasks from completed topics
    await this.addRevisionTasks(student.id, tenantId).catch(() => {});

    if (force) {
      const body = syllabusComplete
        ? '🎉 Syllabus complete! Head to Intensive Revision to maximise your exam score.'
        : `📅 Your plan has been refreshed — ${pendingCount} topics remain for this month.`;
      await this.notificationService.send({
        userId,
        tenantId,
        title: syllabusComplete ? 'Syllabus Complete! 🔥' : 'Your study plan has been updated!',
        body,
        channels: ['push', 'in_app'],
        refType: 'study_plan_regenerated',
        refId: plan.id,
      }).catch(() => {});
    }

    return this.getPlanWithItems(plan.id, tenantId);
  }

  // ——————————————————————————————————————————————————————————————————————————————————————————————————

  private async resolveTopicsForBatch(tenantId: string, batchId: string | null): Promise<Topic[]> {
    if (!batchId) {
      return this.topicRepo.find({
        where: { tenantId, isActive: true },
        relations: ['chapter', 'chapter.subject'],
        order: { sortOrder: 'ASC' },
      });
    }

    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT t.id::text AS id
       FROM topics t
       JOIN chapters c  ON c.id = t.chapter_id  AND c.deleted_at IS NULL
       JOIN subjects s  ON s.id = c.subject_id  AND s.deleted_at IS NULL
       WHERE t.tenant_id = $1
         AND t.is_active = true
         AND t.deleted_at IS NULL
         AND s.is_active = true
         AND (
           s.batch_id = $2
           OR s.id IN (
             SELECT s2.id FROM subjects s2
             JOIN batch_subject_teachers bst
               ON LOWER(TRIM(s2.name)) = LOWER(TRIM(bst.subject_name))
             WHERE bst.batch_id = $2 AND s2.tenant_id = $1 AND s2.is_active = true
           )
           OR s.id IN (
             SELECT DISTINCT s3.id FROM lectures l
             JOIN topics  t3 ON t3.id = l.topic_id   AND t3.deleted_at IS NULL
             JOIN chapters c3 ON c3.id = t3.chapter_id AND c3.deleted_at IS NULL
             JOIN subjects s3 ON s3.id = c3.subject_id AND s3.deleted_at IS NULL
             WHERE l.batch_id = $2 AND l.deleted_at IS NULL
               AND s3.tenant_id = $1 AND s3.is_active = true
           )
           OR s.id IN (
             SELECT DISTINCT s4.id FROM topic_resources tr
             JOIN topics  t4 ON t4.id = tr.topic_id   AND t4.deleted_at IS NULL
             JOIN chapters c4 ON c4.id = t4.chapter_id AND c4.deleted_at IS NULL
             JOIN subjects s4 ON s4.id = c4.subject_id AND s4.deleted_at IS NULL
             WHERE tr.deleted_at IS NULL
               AND s4.tenant_id = $1 AND s4.is_active = true
               AND (
                 s4.batch_id = $2
                 OR s4.id IN (
                   SELECT s5.id FROM subjects s5
                   JOIN batch_subject_teachers bst2
                     ON LOWER(TRIM(s5.name)) = LOWER(TRIM(bst2.subject_name))
                   WHERE bst2.batch_id = $2 AND s5.tenant_id = $1
                 )
               )
           )
         )`,
      [tenantId, batchId],
    );

    if (!rows.length) return [];

    return this.topicRepo.find({
      where: { id: In(rows.map(r => r.id)), tenantId, isActive: true },
      relations: ['chapter', 'chapter.subject'],
      order: { sortOrder: 'ASC' },
    });
  }

  // ——————————————————————————————————————————————————————————————————————————————————————————————————
  //
  // Monthly plan lifecycle:
  //  1. Only PENDING (incomplete) topics appear in the main 30-day plan (study + practice pairs).
  //  2. When a topic is finished it automatically enters SPACED REVISION (addRevisionTasks).
  //  3. When ALL topics are done (syllabus complete) this builder returns [] so the UI
  //     naturally directs the student to INTENSIVE REVISION.

  private buildPlan(
    topics: Topic[],
    completedTopicIds: Set<string>,
    choices: PlanGenerationChoices,
    today: string,
  ): RawPlanItem[] {
    // Group topics by subject, preserving SQL sort order
    const topicsBySubject = new Map<string, Topic[]>();
    for (const topic of topics) {
      const subjectName = topic.chapter?.subject?.name?.trim();
      if (!subjectName) continue;
      if (!topicsBySubject.has(subjectName)) topicsBySubject.set(subjectName, []);
      topicsBySubject.get(subjectName)!.push(topic);
    }

    const subjects = [...topicsBySubject.keys()];
    if (!subjects.length) return [];

    // Build pending topics per subject (completed topics move to spaced revision, not main plan)
    const pendingBySubject = new Map<string, Topic[]>();
    for (const [subj, subjectTopics] of topicsBySubject) {
      const pending = subjectTopics.filter(t => !completedTopicIds.has(t.id));
      if (pending.length) pendingBySubject.set(subj, pending);
    }

    // If every topic is done, return empty — intensive revision unlocks in the UI
    if (pendingBySubject.size === 0) {
      return [];
    }

    // Only include subjects that still have pending topics
    const activeSubjects = subjects.filter(s => pendingBySubject.has(s));

    // Compute daily pacing
    const dailyMinutes = (choices.dailyStudyHours || 4) * 60;
    const classKey = String(choices.currentClass || 'CLASS_11')
      .replace('CLASS_', '')
      .toLowerCase();
    const classPace: Record<string, number> = {
      dropper: 1.3, '12': 1.15, '11': 1.0, '10': 0.85, '9': 0.75,
    };
    const pace = classPace[classKey] ?? 1.0;
    const minutesPerTopic = 45;
    const topicsPerDay = Math.max(2, Math.floor((dailyMinutes / minutesPerTopic) * pace));
    const minutesPerSlot = Math.max(15, Math.floor(dailyMinutes / (topicsPerDay * 2)));

    const basePerSubject = Math.floor(topicsPerDay / activeSubjects.length);
    const extra = topicsPerDay % activeSubjects.length;

    // Per-subject cursors – advance linearly through pending topics
    const pendingCursors = new Map<string, number>(activeSubjects.map(s => [s, 0]));

    const items: RawPlanItem[] = [];

    for (let day = 0; day < 30; day++) {
      const date = this.addDays(today, day);

      activeSubjects.forEach((subject, idx) => {
        const topicsToday = basePerSubject + (idx < extra ? 1 : 0);
        const pending = pendingBySubject.get(subject) ?? [];

        for (let i = 0; i < topicsToday; i++) {
          const pCursor = pendingCursors.get(subject) ?? 0;

          if (pCursor < pending.length) {
            // Schedule a new pending topic: study session + practice session
            const topic = pending[pCursor];
            pendingCursors.set(subject, pCursor + 1);

            // 'revision' type maps to REVISION in DB → rendered as an AI study session
            items.push({
              date,
              type: 'revision',
              title: `Study: ${topic.name}`,
              refId: topic.id,
              subjectName: subject,
              estimatedMinutes: minutesPerSlot,
            });
            // 'practice' type → rendered as a quiz/practice session
            items.push({
              date,
              type: 'practice',
              title: `Practice: ${topic.name}`,
              refId: topic.id,
              subjectName: subject,
              estimatedMinutes: minutesPerSlot,
            });
          }
          // No fallback to completed topics - finished topics live in spaced revision
        }
      });
    }

    return items;
  }

  // â”€â”€â”€ Plan Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async clearCurrentPlan(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    const existing = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (!existing) return { message: 'No existing study plan to clear.' };

    await this.studyPlanRepo.manager.transaction(async (manager) => {
      await manager.delete(PlanItem, { studyPlanId: existing.id });
      await manager.delete(StudyPlan, { id: existing.id });
    });
    return { message: 'Previous study plan removed successfully.' };
  }

  async getToday(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    const plan = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
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
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, query.batchId);
    const planWhere = query.batchId
      ? { studentId: student.id, batchId: query.batchId }
      : { studentId: student.id, batchId: IsNull() };
    const plan = await this.studyPlanRepo.findOne({ where: planWhere as any, withDeleted: true });
    if (!plan) return {};

    const { startDate, endDate } = this.resolveRange(query);
    const items = await this.planItemRepo
      .createQueryBuilder('item')
      .where('item.studyPlanId = :planId', { planId: plan.id })
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

  // â”€â”€â”€ Item Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const plans = await this.studyPlanRepo.find({
      where: { studentId },
      withDeleted: true,
    });
    if (!plans.length) return false;

    const item = await this.planItemRepo.findOne({
      where: {
        studyPlanId: In(plans.map(p => p.id)),
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

  // â”€â”€â”€ Revision Tab Endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getRevisionSpaced(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);

    const topics = await this.resolveTopicsForBatch(effectiveTenantId, batchId ?? null);

    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };

    const debugPlan = await this.studyPlanRepo.findOne({ where: planWhere as any, order: { createdAt: 'DESC' } });
    const debugItems = debugPlan ? await this.planItemRepo.find({ where: { studyPlanId: debugPlan.id } }) : [];
    const debugCompleted = debugItems.filter(i => i.status === PlanItemStatus.COMPLETED && [PlanItemType.PRACTICE, PlanItemType.REVISION].includes(i.type));
    const debugAiSessions = await this.aiStudySessionRepo.find({ where: { studentId: student.id, isCompleted: true } });

    require('fs').writeFileSync('d:/Edva/eddva_backend/debug_spaced.log', JSON.stringify({
      userId, tenantId, effectiveTenantId, batchId,
      studentId: student.id,
      topicsResolved: topics.length,
      topicSample: topics.slice(0, 3).map(t => ({ id: t.id, name: t.name })),
      planId: debugPlan?.id ?? null,
      allPlanItems: debugItems.length,
      completedPracticeItems: debugCompleted.length,
      completedPracticeRefIds: debugCompleted.slice(0, 5).map(i => i.refId),
      completedAiSessions: debugAiSessions.length,
      aiSessionTopicIds: debugAiSessions.slice(0, 5).map(s => s.topicId),
    }, null, 2));

    if (!topics.length) return [];

    const topicIds = topics.map(t => t.id);
    const topicMap = new Map(topics.map(t => [t.id, t]));
    const today = new Date();

    // Build accuracy map from quiz sessions (topicProgress)
    const progressRows = await this.topicProgressRepo.find({
      where: { studentId: student.id, topicId: In(topicIds) },
    });
    const progressMap = new Map(progressRows.map(tp => [tp.topicId, tp]));

    // Collect studied topic IDs from three signals:
    // 1. Completed plan items (lecture, practice, revision types)
    // 2. Completed AI study sessions
    // 3. Quiz attempts (topicProgress.attemptCount > 0)
    const studiedTopics = new Map<string, { lastStudiedAt: Date; accuracy: number; attemptCount: number }>();

    // Signal 1: completed plan items scoped to this student's plan
    const plan = await this.studyPlanRepo.findOne({
      where: planWhere as any,
      order: { createdAt: 'DESC' },
    });
    if (plan) {
      // For practice/revision items refId is the topicId directly;
      // lecture items use refId as lectureId so we skip them here.
      const completedItems = await this.planItemRepo.find({
        where: {
          studyPlanId: plan.id,
          status: PlanItemStatus.COMPLETED,
          type: In([PlanItemType.PRACTICE, PlanItemType.REVISION]),
        },
      });
      for (const item of completedItems) {
        const topicId = item.refId;
        if (!topicId || !topicIds.includes(topicId)) continue;
        const completedAt = item.completedAt ?? new Date();
        const existing = studiedTopics.get(topicId);
        if (!existing || completedAt > existing.lastStudiedAt) {
          const tp = progressMap.get(topicId);
          studiedTopics.set(topicId, {
            lastStudiedAt: completedAt,
            accuracy: tp?.bestAccuracy ?? 0,
            attemptCount: tp?.attemptCount ?? 0,
          });
        }
      }
    }

    // Signal 2: completed AI study sessions
    const aiSessions = await this.aiStudySessionRepo.find({
      where: { studentId: student.id, topicId: In(topicIds), isCompleted: true },
    });
    for (const session of aiSessions) {
      const completedAt = session.completedAt ?? new Date();
      const existing = studiedTopics.get(session.topicId);
      if (!existing || completedAt > existing.lastStudiedAt) {
        const tp = progressMap.get(session.topicId);
        studiedTopics.set(session.topicId, {
          lastStudiedAt: completedAt,
          accuracy: tp?.bestAccuracy ?? 0,
          attemptCount: tp?.attemptCount ?? 0,
        });
      }
    }

    // Signal 3: quiz attempts (even if not in plan or AI session)
    for (const tp of progressRows) {
      if (tp.attemptCount > 0 && !studiedTopics.has(tp.topicId)) {
        studiedTopics.set(tp.topicId, {
          lastStudiedAt: tp.completedAt ?? tp.updatedAt,
          accuracy: tp.bestAccuracy ?? 0,
          attemptCount: tp.attemptCount,
        });
      }
    }

    const result = [];
    for (const [topicId, data] of studiedTopics.entries()) {
      const topic = topicMap.get(topicId);
      if (!topic) continue;

      // Topics mastered (â‰¥75% accuracy with quiz attempts) don't need spaced revision
      if (data.attemptCount > 0 && data.accuracy >= 75) continue;

      // Interval: if no quiz data yet, default to 7 days (60% proxy)
      const effectiveAccuracy = data.attemptCount > 0 ? data.accuracy : 60;
      const intervalDays: 1 | 3 | 7 | 21 =
        effectiveAccuracy < 40 ? 1 : effectiveAccuracy < 55 ? 3 : effectiveAccuracy < 65 ? 7 : 21;

      const nextRevisionDate = new Date(data.lastStudiedAt);
      nextRevisionDate.setDate(nextRevisionDate.getDate() + intervalDays);
      const isOverdue = nextRevisionDate < today;

      result.push({
        topicId,
        topicName: topic.name,
        chapterName: topic.chapter?.name ?? '',
        subjectName: topic.chapter?.subject?.name ?? '',
        accuracy: data.accuracy,
        attemptCount: data.attemptCount,
        lastStudiedAt: data.lastStudiedAt.toISOString(),
        nextRevisionDate: nextRevisionDate.toISOString(),
        isOverdue,
        intervalDays,
      });
    }

    return result.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      return a.accuracy - b.accuracy;
    });
  }

  async getRevisionIntensive(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);

    const topics = await this.resolveTopicsForBatch(effectiveTenantId, batchId ?? null);
    if (!topics.length) return [];

    const topicIds = topics.map(t => t.id);
    const progressRows = await this.topicProgressRepo.find({
      where: { studentId: student.id, topicId: In(topicIds) },
    });
    const progressMap = new Map(progressRows.map(tp => [tp.topicId, tp]));

    // Build subject â†’ chapter â†’ topic hierarchy
    type SubjectEntry = {
      subjectId: string;
      subjectName: string;
      topicsTotal: number;
      topicsCompleted: number;
      chapters: ChapterEntry[];
    };
    type ChapterEntry = {
      chapterId: string;
      chapterName: string;
      topicsTotal: number;
      topicsCompleted: number;
      overallAccuracy: number;
      topics: TopicEntry[];
    };
    type TopicEntry = {
      topicId: string;
      topicName: string;
      status: TopicStatus;
      bestAccuracy: number;
      attemptCount: number;
      completedAt: Date | null;
    };

    const subjectMap = new Map<string, { subjectId: string; subjectName: string; chapters: Map<string, { chapterId: string; chapterName: string; topics: TopicEntry[] }> }>();

    for (const topic of topics) {
      const subject = topic.chapter?.subject;
      const chapter = topic.chapter;
      if (!subject || !chapter) continue;

      if (!subjectMap.has(subject.id)) {
        subjectMap.set(subject.id, { subjectId: subject.id, subjectName: subject.name, chapters: new Map() });
      }
      const subEntry = subjectMap.get(subject.id)!;

      if (!subEntry.chapters.has(chapter.id)) {
        subEntry.chapters.set(chapter.id, { chapterId: chapter.id, chapterName: chapter.name, topics: [] });
      }
      const chEntry = subEntry.chapters.get(chapter.id)!;

      const progress = progressMap.get(topic.id);
      chEntry.topics.push({
        topicId: topic.id,
        topicName: topic.name,
        status: progress?.status ?? TopicStatus.LOCKED,
        bestAccuracy: progress?.bestAccuracy ?? 0,
        attemptCount: progress?.attemptCount ?? 0,
        completedAt: progress?.completedAt ?? null,
      });
    }

    return [...subjectMap.values()].map(s => {
      const chapters: ChapterEntry[] = [...s.chapters.values()].map(ch => {
        const topicsTotal = ch.topics.length;
        const completed = ch.topics.filter(t => t.status === TopicStatus.COMPLETED);
        const topicsCompleted = completed.length;
        const overallAccuracy = topicsCompleted > 0
          ? completed.reduce((sum, t) => sum + t.bestAccuracy, 0) / topicsCompleted
          : 0;
        return { ...ch, topicsTotal, topicsCompleted, overallAccuracy };
      });
      const topicsTotal = chapters.reduce((s, c) => s + c.topicsTotal, 0);
      const topicsCompleted = chapters.reduce((s, c) => s + c.topicsCompleted, 0);
      return { subjectId: s.subjectId, subjectName: s.subjectName, topicsTotal, topicsCompleted, chapters };
    });
  }

  async getRevisionNotes(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);

    const topics = await this.resolveTopicsForBatch(effectiveTenantId, batchId ?? null);
    if (!topics.length) return [];

    const topicIds = topics.map(t => t.id);
    const topicMap = new Map(topics.map(t => [t.id, t]));

    const sessions = await this.aiStudySessionRepo.find({
      where: { studentId: student.id, topicId: In(topicIds), isCompleted: true },
      order: { completedAt: 'DESC' },
    });

    return sessions.map(session => {
      const topic = topicMap.get(session.topicId);
      return {
        id: session.id,
        topicId: session.topicId,
        topicName: topic?.name ?? '',
        chapterName: topic?.chapter?.name ?? '',
        subjectName: topic?.chapter?.subject?.name ?? '',
        completedAt: session.completedAt,
        isCompleted: true,
        timeSpentSeconds: session.timeSpentSeconds ?? 0,
        keyConcepts: session.keyConcepts ?? [],
        formulas: session.formulas ?? [],
        highlights: (session.highlights ?? []) as Array<{ text: string; color: string }>,
        inlineComments: (session.inlineComments ?? []) as Array<{ id: string; text: string; quote: string; top: number }>,
        conversation: (session.conversation ?? []) as Array<{ role: 'student' | 'ai'; message: string; timestamp: string }>,
        lessonMarkdown: session.lessonMarkdown ?? '',
        practiceQuestions: [],
        commonMistakes: [],
      };
    });
  }

  async getRevisionPractice(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);

    const topics = await this.resolveTopicsForBatch(effectiveTenantId, batchId ?? null);
    if (!topics.length) return [];

    const topicIds = topics.map(t => t.id);
    const topicMap = new Map(topics.map(t => [t.id, t]));

    // Only show topics where a dedicated practice plan item was completed.
    // AI notes sessions are excluded — their embedded practice questions show in Notes.
    const plan = await this.studyPlanRepo.findOne({
      where: { studentId: student.id },
      order: { createdAt: 'DESC' },
    });
    if (!plan) return [];

    const completedPracticeItems = await this.planItemRepo.find({
      where: {
        studyPlanId: plan.id,
        status: PlanItemStatus.COMPLETED,
        type: PlanItemType.PRACTICE,
      },
      order: { completedAt: 'DESC' },
    });

    // Deduplicate by topicId — keep the most recent completion
    const seenTopics = new Set<string>();
    const practiceTopicIds: Array<{ topicId: string; completedAt: Date }> = [];
    for (const item of completedPracticeItems) {
      if (!item.refId || !topicIds.includes(item.refId) || seenTopics.has(item.refId)) continue;
      seenTopics.add(item.refId);
      practiceTopicIds.push({ topicId: item.refId, completedAt: item.completedAt ?? new Date() });
    }

    if (!practiceTopicIds.length) return [];

    // Fetch AI sessions for these topics to get practice questions
    const aiSessionMap = new Map<string, AiStudySession>();
    const aiSessions = await this.aiStudySessionRepo.find({
      where: { studentId: student.id, topicId: In(practiceTopicIds.map(p => p.topicId)) },
      order: { completedAt: 'DESC' },
    });
    for (const s of aiSessions) {
      if (!aiSessionMap.has(s.topicId)) aiSessionMap.set(s.topicId, s);
    }

    return practiceTopicIds.map(({ topicId, completedAt }) => {
      const topic = topicMap.get(topicId);
      const session = aiSessionMap.get(topicId);
      return {
        id: `practice-${topicId}`,
        topicId,
        topicName: topic?.name ?? '',
        chapterName: topic?.chapter?.name ?? '',
        subjectName: topic?.chapter?.subject?.name ?? '',
        completedAt,
        isCompleted: true,
        timeSpentSeconds: session?.timeSpentSeconds ?? 0,
        practiceQuestions: (session?.practiceQuestions ?? []) as any[],
        lessonMarkdown: '',
        keyConcepts: [],
        formulas: [],
        commonMistakes: [],
        highlights: [],
        conversation: [],
      };
    });
  }

  // â”€â”€â”€ Other Public Methods â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  @Cron('0 1 * * 1', { timeZone: 'Asia/Kolkata' })
  async weeklyPlanReview() {
    // Intentionally disabled: plans are generated/regenerated by explicit student action.
    return;
  }

  async getNextAction(userId: string, tenantId: string, batchId?: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const effectiveTenantId = await this.resolveEffectiveTenantId(student, tenantId, batchId);
    const planWhere = batchId
      ? { studentId: student.id, batchId }
      : { studentId: student.id, batchId: IsNull() };
    const plan = await this.studyPlanRepo.findOne({ where: planWhere as any });
    if (!plan) {
      return { action: 'no_plan', title: 'No study plan yet!', description: 'Generate your personalised plan to get started.', xpReward: 0 };
    }

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
          return { action: 'watch_lecture', title: item.title, description: `${content.topicName ?? ''} · ${content.videoDurationSeconds ? Math.ceil(content.videoDurationSeconds / 60) + ' min' : ''}`.trim(), lectureId: item.refId, planItemId: item.id, topicName: content.topicName, subjectName: content.subjectName, estimatedMinutes: item.estimatedMinutes, xpReward: 10 };
        case PlanItemType.MOCK_TEST:
          return { action: 'take_quiz', title: item.title, description: `${content.questionCount ?? '?'} questions · ${content.durationMinutes ?? '?'} min`, mockTestId: item.refId, planItemId: item.id, estimatedMinutes: item.estimatedMinutes, xpReward: 20 };
        case PlanItemType.PRACTICE:
          return { action: 'ai_study', title: item.title, description: `Practice: ${content.topicName ?? item.title}`, topicId: item.refId, planItemId: item.id, topicName: content.topicName, subjectName: content.subjectName, estimatedMinutes: item.estimatedMinutes, xpReward: 8 };
        case PlanItemType.REVISION:
          return { action: 'revision', title: item.title, description: `Spaced revision · ${content.chapterName ?? ''}`, topicId: item.refId, planItemId: item.id, topicName: content.topicName, subjectName: content.subjectName, estimatedMinutes: item.estimatedMinutes, xpReward: 6 };
        case PlanItemType.BATTLE:
          return { action: 'battle', title: item.title, description: 'Challenge a classmate and earn XP', estimatedMinutes: 30, xpReward: 25 };
        default:
          return { action: 'ai_study', title: item.title, description: item.title, topicId: item.refId, planItemId: item.id, estimatedMinutes: item.estimatedMinutes, xpReward: 5 };
      }
    }

    return { action: 'all_done', title: "All tasks done today! 🎉 Battle time?", description: "You crushed today's plan. Try a battle or review weak topics.", xpReward: 0 };
  }

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

    const sessionType = intervalDays === 1 ? 'INTENSIVE' : intervalDays === 3 ? 'STANDARD' : intervalDays === 7 ? 'QUICK' : 'FLASH';
    const estimatedMinutes = intervalDays === 1 ? 20 : intervalDays === 3 ? 15 : intervalDays === 7 ? 10 : 5;
    const targetAccuracy = Math.min(accuracy + 15, 85);
    const drillCount = sessionType === 'INTENSIVE' ? 10 : sessionType === 'STANDARD' ? 7 : sessionType === 'QUICK' ? 5 : 3;
    const conceptCount = sessionType === 'FLASH' ? 0 : 2;
    const baseDifficulty = accuracy < 40 ? 'easy' : accuracy < 65 ? 'medium' : 'hard';

    const student = await this.getStudentByUserId(userId, tenantId);
    const existingSession = await this.aiStudySessionRepo.findOne({
      where: { studentId: student.id, topicId },
      order: { createdAt: 'DESC' } as any,
    });

    const conceptQuestions = (existingSession?.practiceQuestions ?? [])
      .slice(0, conceptCount)
      .map(q => ({ question: q.question, answer: q.answer, explanation: q.explanation ?? '' }));
    const keyConcepts = existingSession?.keyConcepts ?? [];

    let drillQuestions: Array<{ question: string; options: string[]; correctAnswer: string; explanation: string; difficulty: string }> = [];
    try {
      const generated = await this.aiBridgeService.generateQuestionsFromTopic(
        { topicId, topicName: topic.name, count: drillCount, difficulty: baseDifficulty, type: 'mcq_single', subject: topic.chapter?.subject?.name, chapter: topic.chapter?.name, examTarget: student.examTarget ?? undefined },
        tenantId,
        'coaching',
      );
      if (Array.isArray(generated)) {
        drillQuestions = generated.map(q => {
          const rawOpts: any[] = q.options ?? q.choices ?? [];
          const options = rawOpts.map((o: any) => typeof o === 'string' ? o : (o.content ?? o.text ?? o.value ?? String(o)));
          return { question: q.question ?? q.questionText ?? '', options, correctAnswer: q.answer ?? q.correctAnswer ?? '', explanation: q.explanation ?? '', difficulty: q.difficulty ?? baseDifficulty };
        });
      }
    } catch (e) {
      this.logger.warn(`[RevisionSession] Question generation failed: ${(e as Error).message}`);
    }

    const recallPrompts = keyConcepts.length > 0
      ? keyConcepts.slice(0, 3).map((c: string) => `Can you recall: "${c}"?`)
      : [`What are the 3 most important concepts in "${topic.name}"?`, `Write down 1 formula or definition you remember from this topic.`, `What part of "${topic.name}" did you find most challenging?`];

    return { sessionType, estimatedMinutes, targetAccuracy, previousAccuracy: accuracy, topicName: topic.name, subjectName: topic.chapter?.subject?.name ?? '', chapterName: topic.chapter?.name ?? '', recallPrompts, conceptQuestions, drillQuestions };
  }

  async getCoursesWithPlanStatus(userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const enrollments = await this.enrollmentRepo.find({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
    });

    const batchIds = enrollments.map(e => e.batchId).filter(Boolean);
    const plans = batchIds.length
      ? await this.studyPlanRepo.find({ where: { studentId: student.id, batchId: In(batchIds) } })
      : [];
    const planByBatch = new Map(plans.map(p => [p.batchId, p]));

    return enrollments
      .filter(e => e.batch)
      .map(e => {
        const plan = planByBatch.get(e.batchId) ?? null;
        return {
          batchId: e.batchId,
          batchName: e.batch!.name,
          examTarget: e.batch!.examTarget ?? null,
          thumbnailUrl: (e.batch as any).thumbnailUrl ?? null,
          enrolledAt: e.enrolledAt,
          plan: plan ? { id: plan.id, generatedAt: plan.generatedAt, validUntil: plan.validUntil, isValid: plan.validUntil ? new Date(plan.validUntil) > new Date() : false } : null,
        };
      });
  }

  async onTopicCreated(topicId: string, batchId: string | null, tenantId: string) {
    if (!batchId) return;
    const topic = await this.topicRepo.findOne({ where: { id: topicId, tenantId }, relations: ['chapter', 'chapter.subject'] });
    if (!topic) return;

    const enrollments = await this.enrollmentRepo.find({ where: { batchId, status: EnrollmentStatus.ACTIVE } });
    if (!enrollments.length) return;

    const studentIds = enrollments.map(e => e.studentId);
    const plans = await this.studyPlanRepo.find({ where: { studentId: In(studentIds), batchId } });

    for (const plan of plans) {
      const alreadyIn = await this.planItemRepo.findOne({ where: { studyPlanId: plan.id, refId: topicId, type: PlanItemType.PRACTICE, status: Not(PlanItemStatus.SKIPPED) } });
      if (alreadyIn) continue;

      const lastTask = await this.planItemRepo.findOne({ where: { studyPlanId: plan.id }, order: { scheduledDate: 'DESC', sortOrder: 'DESC' } });
      const scheduledDate = this.addDays(lastTask?.scheduledDate ?? this.todayIst(), 1);

      await this.planItemRepo.save(
        this.planItemRepo.create({ studyPlanId: plan.id, scheduledDate, type: PlanItemType.PRACTICE, refId: topicId, title: `Study: ${topic.name}`, estimatedMinutes: topic.estimatedStudyMinutes || 45, sortOrder: 0, status: PlanItemStatus.PENDING }),
      );
    }
  }

  async onTopicGatePassed(studentId: string, topicId: string, tenantId: string) {
    const currentTopic = await this.topicRepo.findOne({ where: { id: topicId, tenantId } });
    if (!currentTopic) return;

    const nextTopic = await this.topicRepo.findOne({
      where: { chapterId: currentTopic.chapterId, sortOrder: MoreThan(currentTopic.sortOrder), tenantId, isActive: true },
      order: { sortOrder: 'ASC' },
    });
    if (!nextTopic) return;

    const existing = await this.topicProgressRepo.findOne({ where: { studentId, topicId: nextTopic.id, tenantId } });
    if (!existing || existing.status === TopicStatus.LOCKED) {
      await this.topicProgressRepo.save(
        this.topicProgressRepo.create({ ...(existing ?? {}), studentId, topicId: nextTopic.id, tenantId, status: TopicStatus.UNLOCKED, unlockedAt: new Date(), attemptCount: existing?.attemptCount ?? 0, bestAccuracy: existing?.bestAccuracy ?? 0 }),
      );
    }

    const studyPlans = await this.studyPlanRepo.find({ where: { studentId }, withDeleted: true });
    if (!studyPlans.length) return;

    // Find which study plan owns this topic
    let targetPlan = null;
    for (const plan of studyPlans) {
      const planTopics = await this.resolveTopicsForBatch(plan.tenantId ?? tenantId, plan.batchId);
      if (planTopics.some(t => t.id === nextTopic.id)) {
        targetPlan = plan;
        break;
      }
    }
    if (!targetPlan) return;

    const alreadyIn = await this.planItemRepo.findOne({ where: { studyPlanId: targetPlan.id, refId: nextTopic.id, status: Not(PlanItemStatus.SKIPPED) } });
    if (alreadyIn) return;

    const lastTask = await this.planItemRepo.findOne({ where: { studyPlanId: targetPlan.id }, order: { scheduledDate: 'DESC', sortOrder: 'DESC' } });
    const nextDate = this.addDays(lastTask?.scheduledDate ?? this.todayIst(), 1);

    await this.planItemRepo.save(
      this.planItemRepo.create({ studyPlanId: targetPlan.id, scheduledDate: nextDate, type: PlanItemType.PRACTICE, refId: nextTopic.id, title: `Practice + Notes: ${nextTopic.name}`, estimatedMinutes: nextTopic.estimatedStudyMinutes || 45, sortOrder: 0, status: PlanItemStatus.PENDING }),
    );
  }

  async addRevisionTasks(studentId: string, tenantId: string) {
    const passedTopics = await this.topicProgressRepo.find({
      where: { studentId, status: TopicStatus.COMPLETED },
      relations: ['topic'],
    });
    if (!passedTopics.length) return;

    const studyPlans = await this.studyPlanRepo.find({ where: { studentId }, withDeleted: true });
    if (!studyPlans.length) return;

    const today = this.todayIst();
    const weekStart = this.addDays(today, -new Date(today).getDay());
    const weekEnd = this.addDays(weekStart, 6);

    // Map topicId -> studyPlanId by resolving topics for each active plan
    const topicToPlanId = new Map<string, string>();
    for (const plan of studyPlans) {
      const planTopics = await this.resolveTopicsForBatch(plan.tenantId ?? tenantId, plan.batchId);
      for (const t of planTopics) {
        topicToPlanId.set(t.id, plan.id);
      }
    }

    for (const tp of passedTopics) {
      if (!tp.completedAt || !tp.topic) continue;
      const targetPlanId = topicToPlanId.get(tp.topicId);
      if (!targetPlanId) continue;

      const daysSince = Math.floor((Date.now() - new Date(tp.completedAt).getTime()) / 86400000);
      const isDue = (daysSince >= 7 && daysSince < 8) || (daysSince >= 21 && daysSince < 22) || (daysSince >= 45 && daysSince < 46);
      if (!isDue) continue;

      const existingRev = await this.planItemRepo.findOne({
        where: { studyPlanId: targetPlanId, type: PlanItemType.REVISION, refId: tp.topicId, scheduledDate: Between(weekStart, weekEnd), status: Not(PlanItemStatus.SKIPPED) },
      });
      if (existingRev) continue;

      for (let i = 1; i <= 3; i++) {
        const candidate = this.addDays(today, i);
        const count = await this.planItemRepo.count({ where: { studyPlanId: targetPlanId, scheduledDate: candidate, status: Not(PlanItemStatus.SKIPPED) } });
        if (count < 5) {
          await this.planItemRepo.save(
            this.planItemRepo.create({ studyPlanId: targetPlanId, scheduledDate: candidate, type: PlanItemType.REVISION, refId: tp.topicId, title: `Revise: ${tp.topic.name}`, estimatedMinutes: Math.max(20, Math.ceil((tp.topic.estimatedStudyMinutes || 60) / 2)), sortOrder: count, status: PlanItemStatus.PENDING }),
          );
          break;
        }
      }
    }
  }

  // â”€â”€â”€ Private Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async resolvePlanGenerationChoices(
    student: Student,
    preferences?: GenerateStudyPlanDto,
  ): Promise<PlanGenerationChoices> {
    const existingPlan = await this.studyPlanRepo.findOne({ where: { studentId: student.id }, withDeleted: true });
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
        throw new BadRequestException({ message: 'First-time generation requires popup choices.', requiredFields: ['targetExam', 'examYear', 'currentClass', 'dailyStudyHours'], missingFields });
      }
    }

    if (!targetExam) {
      throw new BadRequestException({ message: 'targetExam is required to generate study plan subjects.', requiredFields: ['targetExam'] });
    }

    student.examTarget = targetExam as any;
    student.examYear = examYear as any;
    student.class = currentClass as any;
    student.dailyStudyHours = dailyStudyHours;
    await this.studentRepo.save(student);

    return { targetExam, examYear, currentClass, dailyStudyHours };
  }

  private async getCompletedTopicIds(studentId: string): Promise<Set<string>> {
    const rows = await this.topicProgressRepo.find({
      where: { studentId, status: TopicStatus.COMPLETED },
      select: ['topicId'],
    });
    return new Set(rows.map(r => r.topicId).filter(Boolean));
  }

  private async getOwnedItem(itemId: string, userId: string, tenantId: string) {
    const student = await this.getStudentByUserId(userId, tenantId);
    const item = await this.planItemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`Plan item ${itemId} not found`);

    const plan = await this.studyPlanRepo.findOne({ where: { id: item.studyPlanId, studentId: student.id }, withDeleted: true });
    if (!plan) throw new ForbiddenException('You do not own this plan item');

    return { item, plan, student };
  }

  private async getPlanWithItems(planId: string, tenantId: string) {
    const plan = await this.studyPlanRepo.findOne({ where: { id: planId }, withDeleted: true });
    if (!plan) throw new NotFoundException('Study plan not found');
    const items = await this.planItemRepo.find({ where: { studyPlanId: plan.id }, order: { scheduledDate: 'ASC', sortOrder: 'ASC' } });
    return { ...plan, items: await this.resolvePlanItems(items, tenantId) };
  }

  private async resolvePlanItems(items: PlanItem[], tenantId: string, studentId?: string) {
    const lectureIds  = items.filter(i => i.type === PlanItemType.LECTURE  && i.refId).map(i => i.refId!);
    const mockTestIds = items.filter(i => i.type === PlanItemType.MOCK_TEST && i.refId).map(i => i.refId!);
    const topicRefIds = items.filter(i => (i.type === PlanItemType.PRACTICE || i.type === PlanItemType.REVISION) && i.refId).map(i => i.refId!);

    const [lectures, mockTests, topics, lectureProgresses] = await Promise.all([
      lectureIds.length  ? this.lectureRepo.find({ where: { id: In(lectureIds), tenantId }, relations: ['topic', 'topic.chapter', 'topic.chapter.subject'] }) : [],
      mockTestIds.length ? this.mockTestRepo.find({ where: { id: In(mockTestIds), tenantId } }) : [],
      topicRefIds.length ? this.topicRepo.find({ where: { id: In(topicRefIds), tenantId }, relations: ['chapter', 'chapter.subject'] }) : [],
      (studentId && lectureIds.length) ? this.lectureProgressRepo.find({ where: { studentId, lectureId: In(lectureIds) } }) : [],
    ]);

    const topicIds = topics.map(t => t.id);
    const topicResources = topicIds.length
      ? await this.topicResourceRepo.find({ where: { tenantId, topicId: In(topicIds), isActive: true }, order: { sortOrder: 'ASC', createdAt: 'ASC' } })
      : [];
    const resourcesByTopic = new Map<string, TopicResource[]>();
    for (const r of topicResources) {
      if (!resourcesByTopic.has(r.topicId)) resourcesByTopic.set(r.topicId, []);
      resourcesByTopic.get(r.topicId)!.push(r);
    }

    const progressByLecture = new Map<string, LectureProgress>(
      (lectureProgresses as LectureProgress[]).map(p => [p.lectureId, p] as [string, LectureProgress]),
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

    return items.map(item => {
      if (item.type === PlanItemType.LECTURE && item.refId) {
        const lec = lectures.find(l => l.id === item.refId);
        const lp  = progressByLecture.get(item.refId);
        return { ...pub(item), content: { lectureId: lec?.id, lectureTitle: lec?.title || item.title, topicName: lec?.topic?.name ?? null, subjectName: lec?.topic?.chapter?.subject?.name ?? null, thumbnailUrl: lec?.thumbnailUrl ?? null, videoDurationSeconds: lec?.videoDurationSeconds ?? null, watchPercentage: lp?.watchPercentage ?? 0 } };
      }
      if (item.type === PlanItemType.MOCK_TEST && item.refId) {
        const mt = mockTests.find(m => m.id === item.refId);
        return { ...pub(item), content: { mockTestId: mt?.id, questionCount: (mt?.questionIds as string[] | null)?.length ?? null, durationMinutes: mt?.durationMinutes ?? null } };
      }
      if ((item.type === PlanItemType.PRACTICE || item.type === PlanItemType.REVISION) && item.refId) {
        const topic = topics.find(t => t.id === item.refId);
        const resources = topic ? (resourcesByTopic.get(topic.id) ?? []) : [];
        const videoRes =
          resources.find(r => r.type === ResourceType.VIDEO && (!!r.externalUrl || !!r.fileUrl)) ??
          resources.find(r => r.type === ResourceType.LINK && (r.externalUrl || '').includes('youtu'));
        const notesRes =
          resources.find(r => r.type === ResourceType.NOTES && (!!r.fileUrl || !!r.externalUrl)) ??
          resources.find(r => r.type === ResourceType.PDF && (!!r.fileUrl || !!r.externalUrl));
        const taskKind = item.type === PlanItemType.PRACTICE ? 'practice' : 'ai_notes';
        return { ...pub(item), content: { topicId: topic?.id ?? item.refId, topicName: topic?.name ?? item.title, chapterName: topic?.chapter?.name ?? null, subjectName: topic?.chapter?.subject?.name ?? null, taskKind, videoTitle: videoRes?.title ?? null, videoUrl: videoRes?.externalUrl ?? videoRes?.fileUrl ?? null, notesTitle: notesRes?.title ?? null, notesUrl: notesRes?.fileUrl ?? notesRes?.externalUrl ?? null } };
      }
      return { ...pub(item), content: { subjectName: (item as any).subjectName ?? null } };
    });
  }

  private resolveRange(query: StudyPlanRangeQueryDto) {
    if (query.startDate && query.endDate) return { startDate: query.startDate, endDate: query.endDate };
    const today = new Date();
    const day = today.getUTCDay() || 7;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - (day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { startDate: monday.toISOString().slice(0, 10), endDate: sunday.toISOString().slice(0, 10) };
  }

  private todayIst(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }

  private deriveExamDate(examYear: ExamYear): Date {
    const yearNum = Number.parseInt(String(examYear), 10);
    const fallbackYear = new Date().getUTCFullYear() + 1;
    const y = Number.isFinite(yearNum) && yearNum > 2000 ? yearNum : fallbackYear;
    return new Date(Date.UTC(y, 3, 30, 0, 0, 0, 0));
  }

  private defaultExamYear(): string {
    const y = new Date().getUTCFullYear() + 1;
    const allowed = new Set(Object.values(ExamYear).map(v => String(v)));
    if (allowed.has(String(y))) return String(y);
    return String(ExamYear.Y2028);
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
    const items = await this.planItemRepo.find({ where: { studyPlanId }, order: { scheduledDate: 'ASC' } });
    const existing = new Set(items.map(i => i.scheduledDate));
    const cursor = new Date(`${afterDate}T00:00:00.000Z`);
    do { cursor.setUTCDate(cursor.getUTCDate() + 1); }
    while (existing.has(cursor.toISOString().slice(0, 10)));
    return cursor.toISOString().slice(0, 10);
  }

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

  private async resolveEffectiveTenantId(
    student: Student,
    fallbackTenantId: string,
    batchId?: string | null,
  ): Promise<string> {
    if (batchId) {
      const enrollment = await this.enrollmentRepo.findOne({
        where: { studentId: student.id, batchId, status: EnrollmentStatus.ACTIVE },
        relations: ['batch'],
      }).catch(() => null);
      if (enrollment?.batch?.tenantId) {
        return enrollment.batch.tenantId;
      }
      // Fallback: if not enrolled or relations fail, fetch batch directly to resolve tenant
      const batch = await this.batchRepo.findOne({ where: { id: batchId } }).catch(() => null);
      if (batch?.tenantId) {
        return batch.tenantId;
      }
    }

    const enrollment = await this.enrollmentRepo.findOne({
      where: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
      relations: ['batch'],
      order: { enrolledAt: 'DESC' },
    }).catch(() => null);
    return enrollment?.batch?.tenantId ?? student.tenantId ?? fallbackTenantId;
  }
}
