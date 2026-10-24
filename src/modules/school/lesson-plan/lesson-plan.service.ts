import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';
import { aiRequestStorage } from '../../../common/context/ai-request-context';
import { SchoolTextbookService } from '../textbook/school-textbook.service';
import { SchoolNotificationService } from '../notification/school-notification.service';
import { S3Service } from '../../upload/s3.service';
import { ADMISSION_REJECTED_CODE } from '../../../common/services/ai-admission.constants';
import {
  ADMISSION_DEFER_MS, DEFAULT_PERIODS, DONE_PROGRESS, MAX_ADMISSION_DEFERRALS, EDITABLE_STATUSES, LESSON_PLAN_GENERATE_JOB, LESSON_PLAN_QUEUE, LessonPlanJobData,
  LessonPlanSource, MAX_PERIODS, MIN_PERIODS, PERIOD_FIELDS, PLAN_FIELDS, PlanFieldKey, UPLOAD_MAX_TEXT_CHARS, WORKING_STATUSES,
} from './lesson-plan.constants';
import { checkUpload, readPdfText } from './lesson-plan-upload';
import { LESSON_PLAN_DDL } from './lesson-plan.schema';
import {
  LessonPlanContent, QualityIssue, SCHEMA_VERSION, ValidationContext, describeIssues, extractJsonValue,
  renderLegacyFields, renderLegacyPeriod, sourceContextFromReply, validateLessonPlan,
} from './lesson-plan-schema';
import {
  CreateManualLessonPlanDto, GenerateLessonPlansDto, ImportLessonPlanDto, ListLessonPlansQueryDto, RecordProgressDto,
  RegenerateSectionDto, UpdateLessonPlanDto,
} from './dto/lesson-plan.dto';

interface SchoolUser { id: string; role: string; instituteId: string | null; name?: string }

/** India school year, April to March: Oct 2026 -> "2026-2027" (the format syllabus_plans uses). */
export function academicYearFor(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export const DEFAULT_MINUTES_PER_PERIOD = 40;
/** A GENERATING plan older than this is failed by the sweep so the teacher can retry. */
export const STALE_GENERATION_MINUTES = 10;
const SWEEP_INTERVAL_MS = 60_000;
/** Cap on the previous reply quoted back to the model in the repair attempt. */
const REPAIR_QUOTE_CHARS = 12_000;

const clampPeriods = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_PERIODS, Math.max(MIN_PERIODS, v)) : DEFAULT_PERIODS;
};
const clampMinutes = (n: unknown): number | null => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 20 && v <= 120 ? v : null;
};
/** Today's date in India (schools here record teaching days in IST), as YYYY-MM-DD. */
export const istToday = (now = Date.now()): string => new Date(now + 330 * 60_000).toISOString().slice(0, 10);
/** Syllabus Planner statuses in the order a chapter moves through them; progress only ever moves a plan forward. */
const SYLLABUS_RANK_SQL = `CASE status WHEN 'COMPLETED' THEN 3 WHEN 'DELAYED' THEN 2 WHEN 'IN_PROGRESS' THEN 1 ELSE 0 END`;
const SYLLABUS_RANK: Record<string, number> = { IN_PROGRESS: 1, COMPLETED: 3 };

const PLAN_SELECT = `
  p.id, p.institute_id AS "instituteId", p.academic_year AS "academicYear", p.teacher_user_id AS "teacherUserId",
  p.class_id AS "classId", p.subject_id AS "subjectId", p.chapter_id AS "chapterId", p.section_ids AS "sectionIds",
  p.syllabus_plan_id AS "syllabusPlanId", p.title, p.total_periods AS "totalPeriods",
  p.learning_objectives AS "learningObjectives", p.prior_knowledge AS "priorKnowledge", p.methodology,
  p.resources, p.digital_resources AS "digitalResources", p.assessment_plan AS "assessmentPlan",
  p.homework_summary AS "homeworkSummary", p.expected_outcomes AS "expectedOutcomes",
  p.source, p.source_file_url AS "sourceFileUrl", p.source_file_name AS "sourceFileName", p.grounded, p.grounded_pages AS "groundedPages",
  p.status, p.version, p.supersedes_id AS "supersedesId", p.submitted_at AS "submittedAt",
  p.reviewed_by AS "reviewedBy", p.reviewed_at AS "reviewedAt", p.review_comment AS "reviewComment",
  p.error, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  p.schema_version AS "schemaVersion", p.content, p.quality_warnings AS "qualityWarnings",
  p.period_minutes AS "periodMinutes", p.revision, p.generation_ms AS "generationMs",
  c.name AS "className", s.name AS "subjectName", ch.name AS "chapterName", COALESCE(ch.sort_order, 0) AS "chapterOrder",
  tu.name AS "teacherName",
  (SELECT string_agg(sec.name, ', ' ORDER BY sec.name) FROM sections sec WHERE sec.id = ANY(p.section_ids)) AS "sectionNames",
  (SELECT count(*)::int FROM lesson_plan_progress pp WHERE pp.plan_id = p.id AND pp.status IN ('TAUGHT', 'SKIPPED')) AS "progressDone",
  (p.total_periods * GREATEST(1, COALESCE(cardinality(p.section_ids), 0)))::int AS "progressTotal"`;
const PLAN_FROM = `
  FROM chapter_lesson_plans p
  LEFT JOIN classes c ON c.id = p.class_id
  LEFT JOIN subjects s ON s.id = p.subject_id
  LEFT JOIN chapters ch ON ch.id = p.chapter_id
  LEFT JOIN users tu ON tu.id = p.teacher_user_id`;
/** List views leave out the heavy JSON. */
const PLAN_LIST_SELECT = PLAN_SELECT.replace('p.content, ', '');

@Injectable()
export class LessonPlanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LessonPlanService.name);
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    @InjectQueue(LESSON_PLAN_QUEUE) private readonly queue: Queue,
    private readonly ai: AiBridgeService,
    private readonly textbooks: SchoolTextbookService,
    private readonly notifications: SchoolNotificationService,
    private readonly s3: S3Service,
  ) {}

  async onModuleInit() {
    try {
      for (const sql of LESSON_PLAN_DDL) await this.ds.query(sql);
    } catch (err) {
      this.logger.warn(`Lesson plan tables not ensured: ${(err as Error).message}`);
    }
    const sweep = () => void this.failStaleGenerations()
      .catch((e) => this.logger.warn(`Lesson plan stale sweep failed: ${(e as Error).message}`));
    this.sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
    sweep();
  }

  onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── Teacher ──────────────────────────────────────────────────────────────

  /** The class-subjects this teacher teaches (with sections), and their plans. */
  async listMine(user: SchoolUser) {
    const teacherId = await this.teacherIdOf(user);
    const [assignments, plans] = await Promise.all([
      this.ds.query(
        `SELECT a.class_id AS "classId", c.name AS "className", a.subject_id AS "subjectId", s.name AS "subjectName",
                array_agg(DISTINCT a.section_id) FILTER (WHERE a.section_id IS NOT NULL) AS "sectionIds",
                string_agg(DISTINCT sec.name, ', ') AS "sectionNames"
           FROM teacher_academic_assignments a
           JOIN classes c ON c.id = a.class_id
           JOIN subjects s ON s.id = a.subject_id
           LEFT JOIN sections sec ON sec.id = a.section_id
          WHERE a.teacher_id = $1
          GROUP BY a.class_id, c.name, a.subject_id, s.name
          ORDER BY c.name, s.name`,
        [teacherId],
      ),
      this.ds.query(
        `SELECT ${PLAN_LIST_SELECT} ${PLAN_FROM}
          WHERE p.teacher_user_id = $1 AND p.institute_id = $2 AND p.status <> 'ARCHIVED'
          ORDER BY c.name, s.name, "chapterOrder", ch.name, p.version DESC`,
        [user.id, user.instituteId],
      ),
    ]);
    return { success: true, data: { assignments, plans, minutesPerPeriod: await this.periodMinutesFor(user.instituteId!) } };
  }

  /** Chapters of a subject the teacher teaches in that class (for the generator). */
  async chaptersFor(user: SchoolUser, classId: string, subjectId: string) {
    const teacherId = await this.teacherIdOf(user);
    await this.sectionsTaught(teacherId, classId, subjectId);
    return { success: true, data: await this.subjectChapters(subjectId) };
  }

  /** Queues AI generation for the chosen chapters (or the whole subject). */
  async generate(user: SchoolUser, dto: GenerateLessonPlansDto) {
    const teacherId = await this.teacherIdOf(user);
    const sectionIds = await this.sectionsTaught(teacherId, dto.classId, dto.subjectId);
    const all = await this.subjectChapters(dto.subjectId);
    const chapters = dto.allChapters ? all : all.filter((c) => (dto.chapterIds || []).includes(c.id));
    if (!chapters.length) throw new BadRequestException('Choose at least one chapter of this subject');
    const minutes = clampMinutes(dto.minutesPerPeriod) ?? await this.periodMinutesFor(user.instituteId!);

    const year = academicYearFor();
    const working: any[] = await this.ds.query(
      `SELECT id, chapter_id, status FROM chapter_lesson_plans
        WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5
          AND status = ANY($6)`,
      [user.instituteId, year, user.id, dto.classId, dto.subjectId, WORKING_STATUSES],
    );

    const queued: any[] = [];
    const skipped: any[] = [];
    for (const ch of chapters) {
      const existing = working.find((w) => w.chapter_id === ch.id);
      const periods = clampPeriods(dto.periods ?? (await this.syllabusLink(user.instituteId!, dto.classId, dto.subjectId, ch.id, year))?.plannedPeriods ?? DEFAULT_PERIODS);
      let planId: string;
      if (existing) {
        const replaceable = dto.regenerate && ['DRAFT', 'FAILED', 'CHANGES_REQUESTED'].includes(existing.status);
        if (!replaceable) {
          skipped.push({ chapterId: ch.id, chapterName: ch.name, planId: existing.id, status: existing.status });
          continue;
        }
        await this.ds.transaction(async (em) => {
          await em.query(`DELETE FROM chapter_lesson_plan_periods WHERE plan_id = $1`, [existing.id]);
          await em.query(
            `UPDATE chapter_lesson_plans
                SET status = 'GENERATING', source = 'AI', source_file_url = NULL, source_file_name = NULL, source_text = NULL,
                    total_periods = $2, period_minutes = $3,
                    schema_version = ${SCHEMA_VERSION}, content = NULL, quality_warnings = '[]', error = NULL,
                    generation_started_at = NULL, revision = revision + 1, updated_at = now()
              WHERE id = $1`,
            [existing.id, periods, minutes],
          );
        });
        planId = existing.id;
      } else {
        try {
          planId = await this.insertPlan(user, { classId: dto.classId, subjectId: dto.subjectId, chapterId: ch.id }, {
            year, sectionIds, periods, minutes, source: 'AI', status: 'GENERATING',
          });
        } catch (err) {
          // Two requests for the same chapter at once: the second hits the one-working-plan index.
          if ((err as any)?.code === '23505') {
            skipped.push({ chapterId: ch.id, chapterName: ch.name, status: 'GENERATING' });
            continue;
          }
          throw err;
        }
      }
      await this.enqueue(planId, user);
      queued.push({ chapterId: ch.id, chapterName: ch.name, planId });
    }
    return { success: true, data: { queued, skipped, minutesPerPeriod: minutes } };
  }

  /** A blank v2 plan with N empty periods, filled in by hand. */
  async createManual(user: SchoolUser, dto: CreateManualLessonPlanDto) {
    const teacherId = await this.teacherIdOf(user);
    const sectionIds = await this.sectionsTaught(teacherId, dto.classId, dto.subjectId);
    const chapter = (await this.subjectChapters(dto.subjectId)).find((c) => c.id === dto.chapterId);
    if (!chapter) throw new BadRequestException('That chapter is not part of this subject');
    const year = academicYearFor();
    const open = await this.ds.query(
      `SELECT id FROM chapter_lesson_plans
        WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5
          AND chapter_id = $6 AND status = ANY($7) LIMIT 1`,
      [user.instituteId, year, user.id, dto.classId, dto.subjectId, dto.chapterId, WORKING_STATUSES],
    );
    if (open.length) throw new ConflictException('You already have a plan in progress for this chapter');
    const periods = clampPeriods(dto.periods ?? DEFAULT_PERIODS);
    const minutes = clampMinutes(dto.minutesPerPeriod) ?? await this.periodMinutesFor(user.instituteId!);
    const content = blankContent(`${chapter.name} — Lesson Plan`, periods, minutes);
    const planId = await this.ds.transaction(async (em) => {
      const id = await this.insertPlan(user, dto, { year, sectionIds, periods, minutes, source: 'MANUAL', status: 'DRAFT', title: content.title }, em);
      await this.writeContent(em, id, content, this.check(content, { minutesPerPeriod: minutes, allowedPages: new Set() }));
      return id;
    });
    return this.getForTeacher(user, planId);
  }

  /** The teacher's view: the plan, its teaching record per section, and their private notes. */
  async getForTeacher(user: SchoolUser, id: string) {
    const plan = await this.loadPlan(id, user.instituteId);
    if (!plan || plan.teacherUserId !== user.id) throw new NotFoundException('Lesson plan not found');
    const [progress, notes] = await Promise.all([this.progressFor(plan), this.notesFor(plan.id)]);
    return { success: true, data: { ...plan, ...progress, notes } };
  }

  /**
   * Uploads a PDF lesson plan: the original is kept, its text is read here, and
   * the AI turns it into the structured plan (queued, like a generation). The
   * result is a draft the teacher checks and completes before submitting.
   */
  async importUpload(user: SchoolUser, dto: ImportLessonPlanDto, file: { buffer?: Buffer; size?: number; originalname?: string; mimetype?: string } | undefined) {
    const check = checkUpload(file);
    if (!check.ok) {
      if (check.status === 413) throw new PayloadTooLargeException(check.message);
      if (check.status === 415) throw new UnsupportedMediaTypeException(check.message);
      throw new BadRequestException(check.message);
    }
    const teacherId = await this.teacherIdOf(user);
    const sectionIds = await this.sectionsTaught(teacherId, dto.classId, dto.subjectId);
    const chapter = (await this.subjectChapters(dto.subjectId)).find((c) => c.id === dto.chapterId);
    if (!chapter) throw new BadRequestException('That chapter is not part of this subject');
    const year = academicYearFor();
    const open = await this.ds.query(
      `SELECT id FROM chapter_lesson_plans
        WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5
          AND chapter_id = $6 AND status = ANY($7) LIMIT 1`,
      [user.instituteId, year, user.id, dto.classId, dto.subjectId, dto.chapterId, WORKING_STATUSES],
    );
    if (open.length) throw new ConflictException('You already have a plan in progress for this chapter. Discard it before uploading a new one.');

    let extracted: Awaited<ReturnType<typeof readPdfText>>;
    try {
      extracted = await readPdfText(file!.buffer!);
    } catch (err) {
      throw new UnprocessableEntityException((err as Error).message);
    }
    const minutes = clampMinutes(dto.minutesPerPeriod) ?? await this.periodMinutesFor(user.instituteId!);
    let fileUrl: string;
    try {
      fileUrl = await this.s3.upload(`school/${user.instituteId}/lesson-plans/${randomUUID()}.pdf`, file!.buffer!, 'application/pdf');
    } catch (err) {
      this.logger.warn(`Lesson plan upload could not be stored: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The file could not be stored right now. Try again.');
    }
    const fileName = String(file!.originalname || 'lesson-plan.pdf').replace(/[^\w.\- ()]/g, '_').slice(0, 255);

    let planId: string;
    try {
      planId = await this.ds.transaction(async (em) => {
        // The period count is a placeholder: the uploaded plan's own periods replace it.
        const id = await this.insertPlan(user, dto, { year, sectionIds, periods: DEFAULT_PERIODS, minutes, source: 'UPLOAD', status: 'GENERATING' }, em);
        await em.query(
          `UPDATE chapter_lesson_plans SET source_file_url = $2, source_file_name = $3, source_text = $4 WHERE id = $1`,
          [id, fileUrl, fileName, extracted.text],
        );
        return id;
      });
    } catch (err) {
      if ((err as any)?.code === '23505') throw new ConflictException('You already have a plan in progress for this chapter');
      throw err;
    }
    await this.enqueue(planId, user);
    const view = await this.getForTeacher(user, planId);
    return { ...view, data: { ...view.data, upload: { pages: extracted.pages, characters: extracted.chars, truncated: extracted.truncated } } };
  }

  /**
   * Records how one period went in one section of the approved plan, and moves
   * the matching Syllabus Planner entry forward (never back).
   */
  async recordProgress(user: SchoolUser, id: string, dto: RecordProgressDto) {
    const plan = await this.ownPlan(user, id);
    if (plan.status !== 'APPROVED') throw new ConflictException('Teaching progress is recorded on the approved plan');
    const period = plan.periods.find((p: any) => Number(p.periodNo) === Number(dto.periodNo));
    if (!period) throw new BadRequestException(`This plan has no period ${dto.periodNo}`);
    const sections = await this.planSections(plan);
    if (!sections.some((s) => s.id === dto.sectionId)) throw new BadRequestException('That section is not part of this plan');

    if (dto.status === 'NOT_STARTED') {
      await this.ds.query(`DELETE FROM lesson_plan_progress WHERE period_id = $1 AND section_id = $2`, [period.id, dto.sectionId]);
    } else {
      const today = istToday();
      const taughtOn = dto.taughtOn ? dto.taughtOn.slice(0, 10) : dto.status === 'SKIPPED' ? null : today;
      if (taughtOn && taughtOn > today) throw new BadRequestException('The date cannot be in the future');
      await this.ds.query(
        `INSERT INTO lesson_plan_progress (plan_id, period_id, section_id, status, taught_on, note, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (period_id, section_id)
         DO UPDATE SET status = EXCLUDED.status, taught_on = EXCLUDED.taught_on, note = EXCLUDED.note, updated_at = now()`,
        [plan.id, period.id, dto.sectionId, dto.status, taughtOn, dto.note?.trim() || null],
      );
    }
    // The record is what the teacher asked for; a Syllabus Planner hiccup must not undo it.
    await this.syncSyllabus(plan, sections, dto.sectionId)
      .catch((e) => this.logger.warn(`Lesson plan ${id}: syllabus progress not updated: ${(e as Error).message}`));
    return this.getForTeacher(user, id);
  }

  /** The teacher's private notes on their own plan. */
  async saveNotes(user: SchoolUser, id: string, note: string) {
    const plan = await this.ownPlan(user, id);
    if (plan.status === 'ARCHIVED') throw new ConflictException('This version has been replaced; add notes to the current one');
    const [row] = await this.ds.query(
      `INSERT INTO lesson_plan_notes (plan_id, note, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (plan_id) DO UPDATE SET note = EXCLUDED.note, updated_at = now()
       RETURNING note, updated_at AS "updatedAt"`,
      [id, String(note ?? '')],
    );
    return { success: true, data: row ?? { note: String(note ?? ''), updatedAt: new Date().toISOString() } };
  }

  /**
   * Saves the editor. Only a draft or a sent-back plan can be changed, and only
   * from the revision the editor loaded: a save made from an older copy is
   * refused instead of silently overwriting the newer one.
   */
  async update(user: SchoolUser, id: string, dto: UpdateLessonPlanDto) {
    const plan = await this.ownPlan(user, id);
    if (!EDITABLE_STATUSES.includes(plan.status)) throw new ConflictException(this.lockedMessage(plan.status));
    this.assertRevision(plan, dto.revision);

    if (plan.schemaVersion >= SCHEMA_VERSION) {
      if (!dto.content || typeof dto.content !== 'object') throw new BadRequestException('Send the whole plan (content)');
      const result = this.check(dto.content, this.editContext(plan));
      if (!result.content) throw new BadRequestException(describeIssues(result.errors));
      await this.ds.transaction(async (em) => {
        await this.bumpRevision(em, plan);
        await this.writeContent(em, id, result.content!, result);
      });
      return this.getForTeacher(user, id);
    }

    // v1 (text) plans keep the original field-by-field save.
    await this.ds.transaction(async (em) => {
      await this.bumpRevision(em, plan);
      const sets: string[] = [];
      const params: any[] = [id];
      const set = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
      if (dto.title !== undefined) set('title', dto.title.trim());
      for (const [key, col] of Object.entries(PLAN_FIELDS)) {
        const v = (dto as any)[key];
        if (v !== undefined) set(col, String(v));
      }
      if (dto.periods) {
        if (!dto.periods.length) throw new BadRequestException('A plan needs at least one period');
        set('total_periods', dto.periods.length);
        await em.query(`DELETE FROM chapter_lesson_plan_periods WHERE plan_id = $1`, [id]);
        await this.writePeriodRows(em, id, dto.periods.map((p, i) => ({
          periodNo: i + 1,
          title: (p.title || '').trim() || `Period ${i + 1}`,
          objectives: p.objectives || '', activities: p.activities || '', resources: p.resources || '',
          assessment: p.assessment || '', homework: p.homework || '', durationMinutes: null,
        })));
      }
      if (sets.length) await em.query(`UPDATE chapter_lesson_plans SET ${sets.join(', ')} WHERE id = $1`, params);
    });
    return this.getForTeacher(user, id);
  }

  /** Sends the plan to the admin. A plan with structural errors cannot be submitted. */
  async submit(user: SchoolUser, id: string, revision?: number) {
    const plan = await this.ownPlan(user, id);
    if (!EDITABLE_STATUSES.includes(plan.status)) throw new ConflictException(this.lockedMessage(plan.status));
    if (revision !== undefined) this.assertRevision(plan, revision);
    if (plan.schemaVersion >= SCHEMA_VERSION) {
      const result = this.check(plan.content, this.editContext(plan));
      if (result.errors.length) {
        throw new UnprocessableEntityException(`Fix these before submitting:\n${describeIssues(result.errors)}`);
      }
    } else {
      const missing = this.missingForSubmit(plan);
      if (missing) throw new BadRequestException(missing);
    }
    const res = await this.ds.query(
      `UPDATE chapter_lesson_plans SET status = 'PENDING_APPROVAL', submitted_at = now(), revision = revision + 1, updated_at = now()
        WHERE id = $1 AND revision = $2 AND status = ANY($3) RETURNING id`,
      [id, plan.revision, EDITABLE_STATUSES],
    );
    if (!this.rows(res).length) throw new ConflictException('The plan changed while you were submitting it. Reload and try again.');
    void this.notifyAdmins(user, plan).catch((e) => this.logger.warn(`Lesson plan submit notification failed: ${e.message}`));
    return this.getForTeacher(user, id);
  }

  async retry(user: SchoolUser, id: string) {
    const plan = await this.ownPlan(user, id);
    if (plan.status !== 'FAILED') throw new ConflictException('Only a plan whose generation failed can be retried');
    await this.ds.query(
      `UPDATE chapter_lesson_plans SET status = 'GENERATING', error = NULL, generation_started_at = NULL, revision = revision + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
    await this.enqueue(id, user);
    return this.getForTeacher(user, id);
  }

  /**
   * Rewrites ONE part of a draft with AI (a period, or a plan-level part) and
   * leaves everything else exactly as the teacher left it.
   */
  async regenerateSection(user: SchoolUser, id: string, dto: RegenerateSectionDto) {
    const plan = await this.ownPlan(user, id);
    if (!EDITABLE_STATUSES.includes(plan.status)) throw new ConflictException(this.lockedMessage(plan.status));
    if (plan.schemaVersion < SCHEMA_VERSION || !plan.content) throw new BadRequestException('Only structured (v2) plans support section rewrites');
    this.assertRevision(plan, dto.revision);
    const content: LessonPlanContent = plan.content;
    if (dto.part === 'period') {
      if (!dto.periodNumber || dto.periodNumber < 1 || dto.periodNumber > content.periods.length) {
        throw new BadRequestException(`Choose a period between 1 and ${content.periods.length}`);
      }
    }
    const minutes = plan.periodMinutes || DEFAULT_MINUTES_PER_PERIOD;
    const { passages } = await this.textbooks
      .getGroundingPassages(plan.instituteId, { chapterId: plan.chapterId }, 'ebook')
      .catch(() => ({ passages: [] as any[] }));
    const label = dto.part === 'period' ? `period ${dto.periodNumber} (a period object with "number": ${dto.periodNumber})` : `"${dto.part}"`;
    const extra = [
      `Part to rewrite: ${label}.`,
      `Minutes per period: ${minutes}. Objective ids available: ${content.objectives.map((o) => o.id).join(', ') || 'none'}.`,
      dto.instruction ? `Teacher's request: ${dto.instruction}` : '',
      `Current plan JSON: ${JSON.stringify(content).slice(0, 20_000)}`,
    ].filter(Boolean).join('\n');

    const started = Date.now();
    let reply: any;
    try {
      reply = await this.ai.generateTopicContent(
        {
          topicName: plan.chapterName, subjectName: plan.subjectName, chapterName: plan.chapterName,
          contentType: 'lesson_plan_section', difficulty: 'intermediate', length: 'standard',
          examTarget: plan.className, courseName: `${plan.className} ${plan.subjectName}`.trim(), extraContext: extra,
          ...(passages.length ? { sourcePassages: passages } : {}),
        },
        plan.instituteId, 'school',
      );
    } catch (err) {
      this.logger.warn(`Lesson plan ${id} section rewrite failed after ${Date.now() - started}ms: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The AI could not rewrite that part right now. Try again.');
    }

    let part: any;
    try { part = extractJsonValue(reply?.content || ''); } catch {
      throw new UnprocessableEntityException('The AI reply could not be read. Try again.');
    }
    const merged: any = JSON.parse(JSON.stringify(content));
    if (dto.part === 'period') {
      const value = part && typeof part === 'object' && !Array.isArray(part) && part.periods ? part.periods[0] : part;
      merged.periods[dto.periodNumber! - 1] = { ...value, number: dto.periodNumber };
    } else {
      merged[dto.part] = part && typeof part === 'object' && !Array.isArray(part) && dto.part in part ? part[dto.part] : part;
    }
    const before = this.check(content, this.editContext(plan));
    const after = this.check(merged, this.editContext(plan));
    if (!after.content || after.errors.length > before.errors.length) {
      throw new UnprocessableEntityException(`The rewritten part did not fit the plan:\n${describeIssues(after.errors)}`);
    }
    await this.ds.transaction(async (em) => {
      await this.bumpRevision(em, plan);
      await this.writeContent(em, id, after.content!, after);
    });
    this.logger.log(`Lesson plan ${id} rewrote ${dto.part}${dto.periodNumber ? ` ${dto.periodNumber}` : ''} in ${Date.now() - started}ms`);
    return this.getForTeacher(user, id);
  }

  /** Copies an approved plan into a new draft; the approved one stays live until the new one is approved. */
  async newVersion(user: SchoolUser, id: string) {
    const plan = await this.ownPlan(user, id);
    if (plan.status !== 'APPROVED') throw new ConflictException('Only an approved plan can be revised');
    const newId = await this.ds.transaction(async (em) => {
      const open = await em.query(
        `SELECT id FROM chapter_lesson_plans
          WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5
            AND chapter_id = $6 AND status = ANY($7) LIMIT 1`,
        [plan.instituteId, plan.academicYear, user.id, plan.classId, plan.subjectId, plan.chapterId, WORKING_STATUSES],
      );
      if (open.length) throw new ConflictException('A new version of this plan is already in progress');
      const cols = [...Object.values(PLAN_FIELDS), 'schema_version', 'content', 'quality_warnings', 'period_minutes'];
      const res = await em.query(
        `INSERT INTO chapter_lesson_plans (institute_id, academic_year, teacher_user_id, class_id, subject_id, chapter_id,
                                           section_ids, syllabus_plan_id, title, total_periods, ${cols.join(', ')},
                                           source, source_file_url, grounded, grounded_pages, status, version, supersedes_id)
         SELECT institute_id, academic_year, teacher_user_id, class_id, subject_id, chapter_id,
                section_ids, syllabus_plan_id, title, total_periods, ${cols.join(', ')},
                source, source_file_url, grounded, grounded_pages, 'DRAFT', version + 1, id
           FROM chapter_lesson_plans WHERE id = $1
         RETURNING id`,
        [id],
      );
      const created = this.rows(res)[0];
      await em.query(
        `INSERT INTO chapter_lesson_plan_periods (plan_id, period_no, title, objectives, activities, resources, assessment, homework, duration_minutes)
         SELECT $2, period_no, title, objectives, activities, resources, assessment, homework, duration_minutes
           FROM chapter_lesson_plan_periods WHERE plan_id = $1`,
        [id, created.id],
      );
      // The teacher's notes travel with the plan; the teaching record moves over when the new version is approved.
      await em.query(`INSERT INTO lesson_plan_notes (plan_id, note) SELECT $2, note FROM lesson_plan_notes WHERE plan_id = $1`, [id, created.id]);
      return created.id as string;
    });
    return this.getForTeacher(user, newId);
  }

  /** Discards a plan that is not approved or under review. */
  async discard(user: SchoolUser, id: string) {
    const plan = await this.ownPlan(user, id);
    if (!['DRAFT', 'FAILED', 'CHANGES_REQUESTED'].includes(plan.status)) {
      throw new ConflictException('Only a draft, failed or sent-back plan can be discarded');
    }
    await this.ds.query(`DELETE FROM chapter_lesson_plans WHERE id = $1`, [id]);
    return { success: true };
  }

  // ── Generation (queue worker) ────────────────────────────────────────────

  /**
   * Writes one chapter plan from the school's textbook. The reply is validated;
   * a structurally broken reply gets ONE repair attempt with the problems listed,
   * then the plan is FAILED with the reason for the teacher to retry. There is
   * deliberately no canned fallback the admin could approve by mistake.
   */
  async runGeneration(planId: string, deferrals = 0): Promise<void> {
    // Claim the plan: marks when work started, so the sweep can fail it if this worker dies.
    const claimed = this.rows(await this.ds.query(
      `UPDATE chapter_lesson_plans SET generation_started_at = now()
        WHERE id = $1 AND status = 'GENERATING' RETURNING id`,
      [planId],
    ));
    if (!claimed.length) return;
    const rows = await this.ds.query(
      `SELECT p.id, p.institute_id, p.teacher_user_id, p.chapter_id, p.total_periods, p.period_minutes, p.source, p.source_text,
              c.name AS class_name, s.name AS subject_name, ch.name AS chapter_name, i.board
         FROM chapter_lesson_plans p
         JOIN classes c ON c.id = p.class_id
         JOIN subjects s ON s.id = p.subject_id
         JOIN chapters ch ON ch.id = p.chapter_id
         LEFT JOIN institutes i ON i.id = p.institute_id
        WHERE p.id = $1`,
      [planId],
    );
    const plan = rows[0];
    if (!plan) return;
    const started = Date.now();
    const minutes = plan.period_minutes || DEFAULT_MINUTES_PER_PERIOD;
    const isUpload = plan.source === 'UPLOAD';
    try {
      if (isUpload && !String(plan.source_text || '').trim()) throw new Error('The uploaded file has no stored text. Upload it again.');
      const { passages } = await this.textbooks
        .getGroundingPassages(plan.institute_id, { chapterId: plan.chapter_id }, 'ebook')
        .catch(() => ({ passages: [] as any[] }));
      const suppliedPages = passages.map((p: any) => Number(p.page_no ?? p.page)).filter((n: number) => Number.isFinite(n) && n > 0);
      const baseExtra = isUpload
        ? `Minutes per period: ${minutes}. Class: ${plan.class_name}. Keep the number of periods the uploaded plan has.`
        : `Number of periods: ${plan.total_periods}. Minutes per period: ${minutes}. Class: ${plan.class_name}.`;
      const call = (extraContext: string) => aiRequestStorage.run(
        // A worker has no HTTP request: give AI admission the plan's institute and teacher.
        { userId: plan.teacher_user_id, userRole: 'TEACHER', requestId: randomUUID(), instituteId: plan.institute_id },
        () => this.ai.generateTopicContent(
          {
            topicName: plan.chapter_name, subjectName: plan.subject_name, chapterName: plan.chapter_name,
            contentType: isUpload ? 'lesson_plan_extract' : 'lesson_plan', difficulty: 'intermediate', length: 'detailed',
            examTarget: plan.class_name, courseName: `${plan.class_name} ${plan.subject_name}`.trim(),
            extraContext, ...(passages.length ? { sourcePassages: passages } : {}),
            ...(isUpload ? { sourceDocument: plan.source_text } : {}),
          },
          plan.institute_id, 'school', plan.board || undefined,
        ),
      );

      let reply = await call(baseExtra);
      const ctxFor = (r: any): ValidationContext => ({
        // An uploaded plan keeps the teacher's own number of periods.
        expectedPeriods: isUpload ? undefined : plan.total_periods,
        minutesPerPeriod: minutes,
        // Only pages the model was actually given (the AI service may trim the extract to fit).
        ...sourceContextFromReply(r, suppliedPages),
      });
      let result = validateLessonPlan(reply?.content || '', ctxFor(reply));
      let attempts = 1;
      // A generated plan must pass every check (one repair). An uploaded plan is the teacher's
      // own: it becomes a draft with its problems listed for them to fix, and only a reply that
      // could not be read at all gets the repair (a repair would invent content to pass checks).
      if (isUpload ? !result.content : result.errors.length) {
        attempts = 2;
        const problems = describeIssues(result.errors);
        this.logger.warn(`Lesson plan ${planId}: first reply invalid (${result.errors.length} problems); repairing`);
        reply = await call(
          `${baseExtra}\nYOUR PREVIOUS REPLY WAS NOT USABLE. Problems:\n${problems}\n` +
          `Return the complete corrected JSON plan. Previous reply (for reference):\n${String(reply?.content || '').slice(0, REPAIR_QUOTE_CHARS)}`,
        );
        result = validateLessonPlan(reply?.content || '', ctxFor(reply));
      }
      if (isUpload) {
        if (!result.content || !result.content.periods.length) {
          throw new Error(`No lesson plan could be read from the uploaded file after ${attempts} attempt${attempts > 1 ? 's' : ''}. Check that it is a lesson plan for this chapter, or create the plan with AI or by hand.`);
        }
        if (String(plan.source_text).length >= UPLOAD_MAX_TEXT_CHARS) {
          result.warnings.push({ code: 'upload_truncated', message: `The uploaded file is long: only its first ${UPLOAD_MAX_TEXT_CHARS.toLocaleString('en-IN')} characters were read. Check the later periods against your file.` });
        }
      } else if (result.errors.length || !result.content) {
        throw new Error(`The AI's plan was not usable after ${attempts} attempts:\n${describeIssues(result.errors, 6)}`);
      }
      const grounded = !!reply?.source?.grounded && passages.length > 0;
      await this.ds.transaction(async (em) => {
        const ok = this.rows(await em.query(
          `UPDATE chapter_lesson_plans
              SET status = 'DRAFT', error = NULL, grounded = $2, grounded_pages = $3::jsonb, generation_ms = $4,
                  revision = revision + 1, updated_at = now()
            WHERE id = $1 AND status = 'GENERATING' RETURNING id`,
          [planId, grounded, JSON.stringify(reply?.source?.pages ?? suppliedPages), Date.now() - started],
        ));
        if (!ok.length) return; // discarded, timed out or regenerated meanwhile
        await this.writeContent(em, planId, result.content!, result);
      });
      this.logger.log(`Lesson plan ${planId} ${isUpload ? 'read from upload' : 'generated'} in ${Date.now() - started}ms (${attempts} attempt${attempts > 1 ? 's' : ''}, ${result.errors.length} errors, ${result.warnings.length} warnings, grounded=${grounded})`);
    } catch (err) {
      if (isAdmissionBusy(err) && deferrals < MAX_ADMISSION_DEFERRALS && await this.deferGeneration(plan, deferrals)) return;
      const message = isAdmissionBusy(err)
        ? 'The AI was busy with other work for too long. Try again in a few minutes.'
        : (err as Error)?.message || 'Generation failed';
      this.logger.warn(`Lesson plan ${planId} generation failed after ${Date.now() - started}ms: ${message.split('\n')[0]}`);
      await this.ds.query(
        `UPDATE chapter_lesson_plans SET status = 'FAILED', error = $2, generation_ms = $3, revision = revision + 1, updated_at = now()
          WHERE id = $1 AND status = 'GENERATING'`,
        [planId, message.slice(0, 1000), Date.now() - started],
      );
    }
  }

  /**
   * The AI pool was busy (another plan or feature of this school holds its slot):
   * put the plan back in the queue for a little later instead of failing it. The
   * plan stays GENERATING; its clock restarts so the stale sweep does not fail it
   * while it waits. Returns false if it could not be re-queued.
   */
  private async deferGeneration(plan: any, deferrals: number): Promise<boolean> {
    try {
      const res = await this.ds.query(
        `UPDATE chapter_lesson_plans SET generation_started_at = NULL, updated_at = now() WHERE id = $1 AND status = 'GENERATING' RETURNING id`,
        [plan.id],
      );
      if (!this.rows(res).length) return true; // discarded or regenerated meanwhile: nothing to do
      const data: LessonPlanJobData = { planId: plan.id, instituteId: plan.institute_id, teacherUserId: plan.teacher_user_id, deferrals: deferrals + 1 };
      // A distinct job id: the job that is running now still holds the plan's own id.
      await this.queue.add(LESSON_PLAN_GENERATE_JOB, data, {
        jobId: `${plan.id}:retry-${deferrals + 1}`, delay: ADMISSION_DEFER_MS, attempts: 1, removeOnComplete: true, removeOnFail: true,
      });
      this.logger.log(`Lesson plan ${plan.id}: AI pool busy, retrying in ${ADMISSION_DEFER_MS / 1000}s (${deferrals + 1}/${MAX_ADMISSION_DEFERRALS})`);
      return true;
    } catch (e) {
      this.logger.warn(`Lesson plan ${plan.id}: could not re-queue after a busy AI pool: ${(e as Error).message}`);
      return false;
    }
  }

  /** Fails plans stuck in GENERATING (worker crash, restart, lost job) so the teacher can retry. */
  async failStaleGenerations(): Promise<number> {
    const res = await this.ds.query(
      `UPDATE chapter_lesson_plans
          SET status = 'FAILED', error = 'Generation took too long and was stopped. Try again.',
              revision = revision + 1, updated_at = now()
        WHERE status = 'GENERATING'
          AND COALESCE(generation_started_at, updated_at) < now() - make_interval(mins => $1)
        RETURNING id`,
      [STALE_GENERATION_MINUTES],
    );
    const ids = this.rows(res);
    if (ids.length) this.logger.warn(`Failed ${ids.length} stale lesson plan generation(s): ${ids.map((r: any) => r.id).join(', ')}`);
    return ids.length;
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async adminList(user: SchoolUser, q: ListLessonPlansQueryDto) {
    const params: any[] = [user.instituteId];
    const where = [`p.institute_id = $1`];
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (q.status) add('p.status = ?', q.status);
    else where.push(`p.status NOT IN ('ARCHIVED', 'GENERATING', 'FAILED', 'DRAFT')`);
    if (q.teacherUserId) add('p.teacher_user_id = ?', q.teacherUserId);
    if (q.classId) add('p.class_id = ?', q.classId);
    if (q.subjectId) add('p.subject_id = ?', q.subjectId);
    const plans = await this.ds.query(
      `SELECT ${PLAN_LIST_SELECT} ${PLAN_FROM}
        WHERE ${where.join(' AND ')}
        ORDER BY (p.status = 'PENDING_APPROVAL') DESC, p.submitted_at ASC NULLS LAST, p.updated_at DESC
        LIMIT 500`,
      params,
    );
    const [{ pending }] = await this.ds.query(
      `SELECT count(*)::int AS pending FROM chapter_lesson_plans WHERE institute_id = $1 AND status = 'PENDING_APPROVAL'`,
      [user.instituteId],
    );
    return { success: true, data: { plans, pending } };
  }

  async adminGet(user: SchoolUser, id: string) {
    const plan = await this.loadPlan(id, user.instituteId);
    if (!plan) throw new NotFoundException('Lesson plan not found');
    const history = await this.ds.query(
      `SELECT id, version, status, submitted_at AS "submittedAt", reviewed_at AS "reviewedAt", review_comment AS "reviewComment"
         FROM chapter_lesson_plans
        WHERE institute_id = $1 AND teacher_user_id = $2 AND class_id = $3 AND subject_id = $4 AND chapter_id = $5
        ORDER BY version DESC, created_at DESC`,
      [plan.instituteId, plan.teacherUserId, plan.classId, plan.subjectId, plan.chapterId],
    );
    return { success: true, data: { ...plan, history, ...(await this.progressFor(plan)) } };
  }

  async approve(user: SchoolUser, id: string) {
    const plan = await this.reviewable(user, id);
    await this.ds.transaction(async (em) => {
      // The previous approved version (if any) is replaced, inside the same transaction
      // so the one-approved-per-chapter index never sees two.
      const archived = this.rows(await em.query(
        `UPDATE chapter_lesson_plans SET status = 'ARCHIVED', revision = revision + 1, updated_at = now()
          WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5
            AND chapter_id = $6 AND status = 'APPROVED' AND id <> $7
          RETURNING id`,
        [plan.instituteId, plan.academicYear, plan.teacherUserId, plan.classId, plan.subjectId, plan.chapterId, id],
      ));
      const res = await em.query(
        `UPDATE chapter_lesson_plans
            SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now(), review_comment = NULL,
                revision = revision + 1, updated_at = now()
          WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING id`,
        [id, user.id],
      );
      if (!this.rows(res).length) throw new ConflictException('This plan is no longer waiting for approval');
      if (archived.length) {
        // What was already taught stays recorded: carried to the same period numbers of the new version.
        await em.query(
          `INSERT INTO lesson_plan_progress (plan_id, period_id, section_id, status, taught_on, note, updated_at)
           SELECT $1, np.id, op.section_id, op.status, op.taught_on, op.note, op.updated_at
             FROM lesson_plan_progress op
             JOIN chapter_lesson_plan_periods opp ON opp.id = op.period_id
             JOIN chapter_lesson_plan_periods np ON np.plan_id = $1 AND np.period_no = opp.period_no
            WHERE op.plan_id = ANY($2::uuid[])
           ON CONFLICT (period_id, section_id) DO NOTHING`,
          [id, archived.map((r: any) => r.id)],
        );
      }
    });
    void this.notifyTeacher(plan, 'Lesson plan approved', `Your lesson plan for ${plan.chapterName} (${plan.className} ${plan.subjectName}) was approved.`)
      .catch((e) => this.logger.warn(`Lesson plan approve notification failed: ${e.message}`));
    return this.adminGet(user, id);
  }

  async sendBack(user: SchoolUser, id: string, comment: string) {
    const text = String(comment || '').trim();
    if (!text) throw new BadRequestException('Say what needs to change');
    const plan = await this.reviewable(user, id);
    const res = await this.ds.query(
      `UPDATE chapter_lesson_plans
          SET status = 'CHANGES_REQUESTED', reviewed_by = $2, reviewed_at = now(), review_comment = $3,
              revision = revision + 1, updated_at = now()
        WHERE id = $1 AND status = 'PENDING_APPROVAL' RETURNING id`,
      [id, user.id, text],
    );
    if (!this.rows(res).length) throw new ConflictException('This plan is no longer waiting for approval');
    void this.notifyTeacher(plan, 'Lesson plan needs changes', `${plan.chapterName} (${plan.className} ${plan.subjectName}): ${text.slice(0, 160)}`)
      .catch((e) => this.logger.warn(`Lesson plan send-back notification failed: ${e.message}`));
    return this.adminGet(user, id);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** The sections a plan covers, by name; a class without sections is one "section" keyed by the class id. */
  private async planSections(plan: any): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.ds.query(
      `SELECT sec.id, sec.name FROM chapter_lesson_plans p JOIN sections sec ON sec.id = ANY(p.section_ids)
        WHERE p.id = $1 ORDER BY sec.name`,
      [plan.id],
    );
    return rows.length ? rows : [{ id: plan.classId, name: plan.className || 'Whole class' }];
  }

  /** The teaching record of a plan and a per-section summary. */
  private async progressFor(plan: any) {
    const [progress, sections] = await Promise.all([
      this.ds.query(
        `SELECT per.period_no AS "periodNo", pp.section_id AS "sectionId", pp.status,
                to_char(pp.taught_on, 'YYYY-MM-DD') AS "taughtOn", pp.note, pp.updated_at AS "updatedAt"
           FROM lesson_plan_progress pp JOIN chapter_lesson_plan_periods per ON per.id = pp.period_id
          WHERE pp.plan_id = $1 ORDER BY per.period_no`,
        [plan.id],
      ),
      this.planSections(plan),
    ]);
    const total = plan.periods?.length || plan.totalPeriods || 0;
    const progressSummary = sections.map((s) => {
      const mine = progress.filter((r: any) => r.sectionId === s.id);
      const count = (st: string) => mine.filter((r: any) => r.status === st).length;
      return {
        sectionId: s.id, sectionName: s.name, total,
        taught: count('TAUGHT'), partial: count('PARTIAL'), skipped: count('SKIPPED'),
        done: mine.filter((r: any) => DONE_PROGRESS.includes(r.status)).length,
      };
    });
    return { sections, progress, progressSummary };
  }

  private async notesFor(planId: string): Promise<{ note: string; updatedAt: string | null }> {
    const [row] = await this.ds.query(`SELECT note, updated_at AS "updatedAt" FROM lesson_plan_notes WHERE plan_id = $1`, [planId]);
    return row ?? { note: '', updatedAt: null };
  }

  /**
   * Moves the Syllabus Planner entries for this chapter forward from the teaching
   * record: IN_PROGRESS once a period is taught, COMPLETED when every period is
   * taught or skipped. A section's own entry follows that section; a class-wide
   * entry (no section) completes only when every section has. Only entries linked
   * to the chapter (syllabus_plans.chapter_id) are touched; plans that keep their
   * chapters inside chapter_allocations track topic progress there instead.
   */
  private async syncSyllabus(plan: any, sections: Array<{ id: string }>, sectionId: string): Promise<number> {
    const counts: any[] = await this.ds.query(
      `SELECT section_id AS "sectionId",
              count(*) FILTER (WHERE status = ANY($2))::int AS done,
              count(*) FILTER (WHERE status IN ('TAUGHT', 'PARTIAL'))::int AS started
         FROM lesson_plan_progress WHERE plan_id = $1 GROUP BY section_id`,
      [plan.id, DONE_PROGRESS],
    );
    const total = plan.periods?.length || 0;
    const targetFor = (id: string): string | null => {
      const c = counts.find((x) => x.sectionId === id);
      if (!c || !total) return null;
      return c.done >= total ? 'COMPLETED' : c.started > 0 ? 'IN_PROGRESS' : null;
    };
    const targets = sections.map((s) => targetFor(s.id));
    const classTarget = targets.every((t) => t === 'COMPLETED') ? 'COMPLETED' : targets.some(Boolean) ? 'IN_PROGRESS' : null;
    const sectionTarget = targetFor(sectionId);
    const realSection = sections.some((s) => s.id === sectionId) && sectionId !== plan.classId;

    let updated = 0;
    const advance = async (target: string | null, sectionSql: string, extra: any[]) => {
      if (!target) return;
      const res = await this.ds.query(
        `UPDATE syllabus_plans SET status = $1, updated_at = now()
          WHERE institute_id = $2 AND class_id = $3 AND subject_id = $4 AND chapter_id = $5 AND academic_year = $6
            AND ${sectionSql} AND ${SYLLABUS_RANK_SQL} < $7
          RETURNING id`,
        [target, plan.instituteId, plan.classId, plan.subjectId, plan.chapterId, plan.academicYear, SYLLABUS_RANK[target], ...extra],
      );
      updated += this.rows(res).length;
    };
    if (realSection) await advance(sectionTarget, 'section_id = $8', [sectionId]);
    await advance(classTarget, 'section_id IS NULL', []);
    return updated;
  }

  private check(content: unknown, ctx: ValidationContext) {
    return validateLessonPlan(content, ctx);
  }

  private editContext(plan: any): ValidationContext {
    const pages = Array.isArray(plan.groundedPages) ? plan.groundedPages.map(Number).filter((n: number) => n > 0) : [];
    return { minutesPerPeriod: plan.periodMinutes || DEFAULT_MINUTES_PER_PERIOD, allowedPages: new Set(plan.grounded ? pages : []) };
  }

  private assertRevision(plan: any, revision: number | undefined) {
    if (revision === undefined || revision === null) throw new BadRequestException('revision is required');
    if (Number(revision) !== Number(plan.revision)) {
      throw new ConflictException('This plan was changed elsewhere (another tab or device). Reload it to see the latest version before saving.');
    }
  }

  /** Optimistic lock: succeeds only if nobody saved since `plan` was read. */
  private async bumpRevision(em: EntityManager, plan: any) {
    const res = await em.query(
      `UPDATE chapter_lesson_plans SET revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $2 RETURNING id`,
      [plan.id, plan.revision],
    );
    if (!this.rows(res).length) {
      throw new ConflictException('This plan was changed elsewhere (another tab or device). Reload it to see the latest version before saving.');
    }
  }

  /** Stores a v2 plan: JSON, rendered text columns (v1 readers) and period rows. */
  private async writeContent(em: EntityManager, planId: string, content: LessonPlanContent, result: { errors: QualityIssue[]; warnings: QualityIssue[] }) {
    const legacy = renderLegacyFields(content);
    const issues = [
      ...result.errors.map((e) => ({ ...e, severity: 'error' })),
      ...result.warnings.map((w) => ({ ...w, severity: 'warning' })),
    ];
    const cols = Object.entries(PLAN_FIELDS);
    await em.query(
      `UPDATE chapter_lesson_plans
          SET schema_version = ${SCHEMA_VERSION}, content = $2::jsonb, quality_warnings = $3::jsonb, title = $4, total_periods = $5,
              ${cols.map(([, col], i) => `${col} = $${i + 6}`).join(', ')}, updated_at = now()
        WHERE id = $1`,
      [planId, JSON.stringify(content), JSON.stringify(issues), (legacy.title || 'Lesson plan').slice(0, 300), content.periods.length,
        ...cols.map(([key]) => (legacy as any)[key as PlanFieldKey] || '')],
    );
    await em.query(`DELETE FROM chapter_lesson_plan_periods WHERE plan_id = $1`, [planId]);
    await this.writePeriodRows(em, planId, content.periods.map((p) => renderLegacyPeriod(p, content)));
  }

  private async writePeriodRows(em: EntityManager, planId: string, periods: Array<{
    periodNo: number; title: string; objectives: string; activities: string; resources: string; assessment: string; homework: string; durationMinutes: number | null;
  }>) {
    for (const p of periods) {
      await em.query(
        `INSERT INTO chapter_lesson_plan_periods (plan_id, period_no, title, objectives, activities, resources, assessment, homework, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [planId, p.periodNo, (p.title || '').slice(0, 300), p.objectives, p.activities, p.resources, p.assessment, p.homework, p.durationMinutes],
      );
    }
  }

  private async teacherIdOf(user: SchoolUser): Promise<string> {
    const rows = await this.ds.query(`SELECT id FROM teachers WHERE user_id = $1 LIMIT 1`, [user.id]);
    if (!rows.length) throw new ForbiddenException('Only teachers can create lesson plans');
    return rows[0].id;
  }

  /** The teacher's sections for this class and subject; refuses when they do not teach it. */
  private async sectionsTaught(teacherId: string, classId: string, subjectId: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT section_id FROM teacher_academic_assignments WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3`,
      [teacherId, classId, subjectId],
    );
    if (!rows.length) throw new ForbiddenException('You do not teach this subject in this class');
    return rows.map((r: any) => r.section_id).filter(Boolean);
  }

  private async subjectChapters(subjectId: string): Promise<Array<{ id: string; name: string }>> {
    return this.ds.query(
      `SELECT id, name FROM chapters WHERE subject_id = $1 AND is_active IS NOT FALSE ORDER BY sort_order NULLS LAST, name`,
      [subjectId],
    );
  }

  /** The school's period length: the median of its active academic periods, else 40 minutes. */
  async periodMinutesFor(instituteId: string): Promise<number> {
    const rows = await this.ds.query(
      `SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int AS minutes
         FROM school_periods
        WHERE school_id = $1 AND is_active IS NOT FALSE AND end_time > start_time
          AND COALESCE(period_type, 'Academic') NOT ILIKE '%break%' AND COALESCE(period_name, '') NOT ILIKE '%break%'`,
      [instituteId],
    ).catch(() => []);
    return clampMinutes(rows[0]?.minutes) ?? DEFAULT_MINUTES_PER_PERIOD;
  }

  /** The Syllabus Planner entry for this chapter (planned periods): this year's first, else the latest. */
  private async syllabusLink(instituteId: string, classId: string, subjectId: string, chapterId: string, year?: string) {
    const rows = await this.ds.query(
      `SELECT id, planned_periods AS "plannedPeriods" FROM syllabus_plans
        WHERE institute_id = $1 AND class_id = $2 AND subject_id = $3 AND chapter_id = $4
        ORDER BY (academic_year = $5) DESC, created_at DESC LIMIT 1`,
      [instituteId, classId, subjectId, chapterId, year ?? academicYearFor()],
    ).catch(() => []);
    return rows[0] as { id: string; plannedPeriods: number } | undefined;
  }

  private async insertPlan(
    user: SchoolUser,
    ids: { classId: string; subjectId: string; chapterId: string },
    opts: { year: string; sectionIds: string[]; periods: number; minutes: number; source: LessonPlanSource; status: string; title?: string },
    em: EntityManager | DataSource = this.ds,
  ): Promise<string> {
    const link = await this.syllabusLink(user.instituteId!, ids.classId, ids.subjectId, ids.chapterId, opts.year);
    const [prev] = await em.query(
      `SELECT id, version FROM chapter_lesson_plans
        WHERE institute_id = $1 AND academic_year = $2 AND teacher_user_id = $3 AND class_id = $4 AND subject_id = $5 AND chapter_id = $6
        ORDER BY version DESC LIMIT 1`,
      [user.instituteId, opts.year, user.id, ids.classId, ids.subjectId, ids.chapterId],
    );
    const res = await em.query(
      `INSERT INTO chapter_lesson_plans (institute_id, academic_year, teacher_user_id, class_id, subject_id, chapter_id,
                                         section_ids, syllabus_plan_id, title, total_periods, period_minutes, schema_version,
                                         source, status, version, supersedes_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11, ${SCHEMA_VERSION}, $12, $13, $14, $15)
       RETURNING id`,
      [user.instituteId, opts.year, user.id, ids.classId, ids.subjectId, ids.chapterId, opts.sectionIds, link?.id ?? null,
        opts.title ?? null, opts.periods, opts.minutes, opts.source, opts.status, (prev?.version ?? 0) + 1, prev?.id ?? null],
    );
    return this.rows(res)[0].id;
  }

  private async enqueue(planId: string, user: SchoolUser) {
    const data: LessonPlanJobData = { planId, instituteId: user.instituteId!, teacherUserId: user.id };
    try {
      // jobId = plan: a second enqueue of the same plan while one is waiting is a no-op.
      await this.queue.add(LESSON_PLAN_GENERATE_JOB, data, { jobId: planId, attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch (err) {
      await this.ds.query(
        `UPDATE chapter_lesson_plans SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1`,
        [planId, `Could not start generation: ${(err as Error).message}`.slice(0, 500)],
      );
    }
  }

  private async loadPlan(id: string, instituteId: string | null) {
    const rows = await this.ds.query(`SELECT ${PLAN_SELECT} ${PLAN_FROM} WHERE p.id = $1 AND p.institute_id = $2`, [id, instituteId]);
    if (!rows.length) return null;
    const periods = await this.ds.query(
      `SELECT id, period_no AS "periodNo", title, ${PERIOD_FIELDS.join(', ')}, duration_minutes AS "durationMinutes"
         FROM chapter_lesson_plan_periods WHERE plan_id = $1 ORDER BY period_no`,
      [id],
    );
    return { ...rows[0], periods };
  }

  private async ownPlan(user: SchoolUser, id: string) {
    const plan = await this.loadPlan(id, user.instituteId);
    if (!plan || plan.teacherUserId !== user.id) throw new NotFoundException('Lesson plan not found');
    return plan;
  }

  private async reviewable(user: SchoolUser, id: string) {
    const plan = await this.loadPlan(id, user.instituteId);
    if (!plan) throw new NotFoundException('Lesson plan not found');
    if (plan.teacherUserId === user.id) throw new ForbiddenException('You cannot review your own lesson plan');
    if (plan.status !== 'PENDING_APPROVAL') throw new ConflictException('This plan is not waiting for approval');
    return plan;
  }

  private missingForSubmit(plan: any): string | null {
    if (!String(plan.learningObjectives || '').trim()) return 'Add the learning objectives before submitting';
    if (!plan.periods?.length) return 'Add at least one period before submitting';
    const empty = plan.periods.filter((p: any) => !String(p.activities || '').trim()).map((p: any) => p.periodNo);
    if (empty.length) return `Add activities for period ${empty.join(', ')} before submitting`;
    return null;
  }

  private lockedMessage(status: string): string {
    if (status === 'PENDING_APPROVAL') return 'This plan is waiting for approval and cannot be changed';
    if (status === 'APPROVED') return 'An approved plan cannot be changed; start a new version instead';
    if (status === 'GENERATING') return 'This plan is still being generated';
    return 'This plan cannot be changed';
  }

  /** Admins who can act on it: the primary admin and admins with the syllabus permission. */
  private async notifyAdmins(user: SchoolUser, plan: any) {
    const admins: any[] = await this.ds.query(
      `SELECT id FROM users
        WHERE institute_id = $1 AND role::text ILIKE '%INSTITUTE_ADMIN%' AND is_active IS NOT FALSE
          AND (COALESCE(is_primary_admin, FALSE) OR COALESCE(admin_permissions::text, '') LIKE '%"syllabus_planner"%')`,
      [plan.instituteId],
    );
    for (const a of admins) {
      await this.notifications.create({
        userId: a.id, recipientId: a.id, role: 'INSTITUTE_ADMIN', recipientRole: 'INSTITUTE_ADMIN',
        type: 'lesson_plan', category: 'academic', priority: 'normal',
        title: 'Lesson plan waiting for approval',
        message: `${plan.teacherName || user.name || 'A teacher'} submitted ${plan.chapterName} (${plan.className} ${plan.subjectName}).`,
        referenceId: plan.id, referenceType: 'lesson_plan', actionUrl: `/school/admin/lesson-plan-approvals?plan=${plan.id}`,
        isRead: false,
      }).catch(() => undefined);
    }
  }

  private async notifyTeacher(plan: any, title: string, message: string) {
    await this.notifications.create({
      userId: plan.teacherUserId, recipientId: plan.teacherUserId, role: 'TEACHER', recipientRole: 'TEACHER',
      type: 'lesson_plan', category: 'academic', priority: 'normal', title, message,
      referenceId: plan.id, referenceType: 'lesson_plan', actionUrl: `/school/teacher/chapter-lesson-plans/${plan.id}`,
      isRead: false,
    });
  }

  /** TypeORM's Postgres driver returns [rows, count] for UPDATE/DELETE … RETURNING. */
  private rows(res: any): any[] {
    if (Array.isArray(res) && Array.isArray(res[0])) return res[0];
    return Array.isArray(res) ? res : [];
  }
}

/** The backend's AI admission refused the call because the pool stayed full (429 ai_admission_rejected). */
export function isAdmissionBusy(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const body: any = err.getResponse();
  return err.getStatus() === 429 && !!body && typeof body === 'object' && body.error === ADMISSION_REJECTED_CODE;
}

/** An empty v2 plan for a teacher to fill in by hand. */
export function blankContent(title: string, periods: number, minutes: number): LessonPlanContent {
  const intro = Math.min(10, Math.max(5, Math.round(minutes * 0.15)));
  const close = Math.min(10, Math.max(5, Math.round(minutes * 0.15)));
  return {
    schemaVersion: 2,
    title,
    objectives: [{ id: 'O1', text: '', bloom: 'Understand', assessment: '', source: { type: 'suggestion', pages: [] } }],
    outcomes: [], prerequisites: [], keyConcepts: [], resources: [], misconceptions: [],
    differentiation: { support: [], onLevel: [], challenge: [], accessibility: [] },
    groundingNotes: '',
    periods: Array.from({ length: periods }, (_, i) => ({
      number: i + 1, topic: '', objectiveIds: ['O1'],
      sequence: [
        { phase: 'introduction', minutes: intro, teacher: '', students: '' },
        { phase: 'explanation', minutes: minutes - intro - close, teacher: '', students: '' },
        { phase: 'conclusion', minutes: close, teacher: '', students: '' },
      ],
      examples: [], resources: [], checks: [], questions: [{ question: '', answer: '', objectiveIds: ['O1'] }],
      homework: '', exitTicket: '', pages: [],
    })),
  };
}
