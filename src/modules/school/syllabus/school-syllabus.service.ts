import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolSyllabusService implements OnModuleInit {
  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridgeService: AiBridgeService,
  ) {}

  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS syllabus_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          academic_year VARCHAR(50) NOT NULL,
          class_id UUID NOT NULL,
          section_id UUID,
          subject_id UUID NOT NULL,
          chapter_id UUID,
          topic_id UUID,
          teacher_id UUID,
          planned_start_date DATE NOT NULL,
          planned_completion_date DATE NOT NULL,
          planned_periods INT DEFAULT 1,
          priority VARCHAR(20) DEFAULT 'NORMAL',
          term VARCHAR(50),
          status VARCHAR(50) DEFAULT 'PLANNED',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          academic_year VARCHAR(50) NOT NULL,
          class_id UUID NOT NULL,
          section_id UUID NOT NULL,
          subject_id UUID NOT NULL,
          chapter_id UUID,
          topic_id UUID,
          teacher_id UUID NOT NULL,
          date DATE NOT NULL,
          duration_periods INT DEFAULT 1,
          learning_objectives TEXT,
          previous_knowledge TEXT,
          teaching_methodology TEXT,
          teaching_activities TEXT,
          teaching_resources TEXT,
          digital_resources TEXT,
          classroom_activities TEXT,
          assessment_method TEXT,
          homework TEXT,
          expected_learning_outcomes TEXT,
          teacher_notes TEXT,
          timetable_id UUID,
          status VARCHAR(50) DEFAULT 'DRAFT',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_completions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          lesson_plan_id UUID NOT NULL,
          actual_date DATE NOT NULL,
          actual_duration_periods INT DEFAULT 1,
          topics_covered TEXT,
          learning_objectives_achieved TEXT,
          student_understanding_rating INT DEFAULT 4,
          homework_assigned TEXT,
          assessment_conducted TEXT,
          teacher_reflection TEXT,
          completion_type VARCHAR(50) DEFAULT 'FULLY',
          delay_reason TEXT,
          carry_forward_date DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID,
          teacher_id UUID,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) DEFAULT 'Standard',
          content_json JSONB DEFAULT '{}',
          is_global BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lesson_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          institute_id UUID NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id UUID NOT NULL,
          action VARCHAR(100) NOT NULL,
          changed_by_user_id UUID NOT NULL,
          old_values JSONB,
          new_values JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        ALTER TABLE topics ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
        ALTER TABLE topics ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0;
        ALTER TABLE chapters ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
        ALTER TABLE chapters ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0;
        ALTER TABLE syllabus_plans ADD COLUMN IF NOT EXISTS chapter_allocations JSONB DEFAULT '[]';
      `);
    } catch (e) {
      console.error('[SchoolSyllabusService] Table auto-creation error:', e);
    }
  }

  // --- SHARED PROGRESS HELPERS ---
  // syllabus_topic_progress is the single source of truth for a topic's completion
  // status within a specific plan. Every read (tracker, detailed tracker) and every
  // write (manual progress update, lesson completion) goes through these two helpers
  // instead of each having its own bespoke JSON-walk / SQL-aggregate logic.

  private isUuid(v: any): boolean {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  private normalizeTopicStatus(status: any, progress: any): string {
    const s = String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DELAYED'].includes(s)) return s;
    if (s === 'PENDING' || s === 'NOT_STARTED' || s === 'SCHEDULED') return 'PLANNED';
    if (s === 'COMPLETE') return 'COMPLETED';
    if (typeof progress === 'number') {
      if (progress >= 100) return 'COMPLETED';
      if (progress > 0) return 'IN_PROGRESS';
    }
    return 'PLANNED';
  }

  /**
   * Upserts one topic's progress for a plan, then recomputes the topics/chapters/subjects
   * derived-cache columns those tables carry (read by other parts of the app), all inside
   * one transaction so a crash mid-cascade can't leave the caches disagreeing.
   */
  private async upsertTopicProgress(
    syllabusPlanId: string,
    topicRef: { topicId?: string | null; topicName?: string | null; chapterId?: string | null },
    patch: {
      status?: string;
      progress?: number;
      plannedPeriods?: number;
      actualPeriods?: number;
      remarks?: string;
      delayReason?: string;
      carryForwardDate?: string | null;
      updatedBy?: string;
    },
  ): Promise<any> {
    const topicId = this.isUuid(topicRef.topicId) ? topicRef.topicId : null;
    const topicName = (topicRef.topicName || '').trim() || null;
    if (!topicId && !topicName) return null;

    const status = this.normalizeTopicStatus(patch.status, patch.progress);
    const progress = patch.progress !== undefined
      ? patch.progress
      : (status === 'COMPLETED' ? 100 : status === 'IN_PROGRESS' ? 50 : 0);
    const completedAt = status === 'COMPLETED' ? new Date() : null;

    let row: any;
    await this.ds.transaction(async (manager) => {
      const params = [
        syllabusPlanId,
        topicId,
        topicRef.chapterId || null,
        topicName,
        status,
        patch.plannedPeriods ?? 1,
        patch.actualPeriods ?? 0,
        progress,
        patch.remarks ?? null,
        patch.delayReason ?? null,
        patch.carryForwardDate ?? null,
        completedAt,
        patch.updatedBy ?? null,
      ];

      const conflictTarget = topicId
        ? `(syllabus_plan_id, topic_id)`
        : `(syllabus_plan_id, LOWER(BTRIM(topic_name))) WHERE topic_id IS NULL`;

      const res = await manager.query(
        `INSERT INTO syllabus_topic_progress
           (syllabus_plan_id, topic_id, chapter_id, topic_name, status, planned_periods, actual_periods, progress, remarks, delay_reason, carry_forward_date, completed_at, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT ${conflictTarget} DO UPDATE SET
           chapter_id = COALESCE(EXCLUDED.chapter_id, syllabus_topic_progress.chapter_id),
           topic_name = COALESCE(EXCLUDED.topic_name, syllabus_topic_progress.topic_name),
           status = EXCLUDED.status,
           planned_periods = COALESCE(EXCLUDED.planned_periods, syllabus_topic_progress.planned_periods),
           actual_periods = EXCLUDED.actual_periods,
           progress = EXCLUDED.progress,
           remarks = COALESCE(EXCLUDED.remarks, syllabus_topic_progress.remarks),
           delay_reason = COALESCE(EXCLUDED.delay_reason, syllabus_topic_progress.delay_reason),
           carry_forward_date = COALESCE(EXCLUDED.carry_forward_date, syllabus_topic_progress.carry_forward_date),
           completed_at = COALESCE(EXCLUDED.completed_at, syllabus_topic_progress.completed_at),
           updated_by = COALESCE(EXCLUDED.updated_by, syllabus_topic_progress.updated_by),
           updated_at = NOW()
         RETURNING *`,
        params,
      );
      row = res[0];

      if (topicId) {
        await this.recomputeDerivedCaches(manager, topicId, topicRef.chapterId || null);
      }
    });

    return row;
  }

  /** Recomputes topics.status/progress, chapters.status/progress, subjects.progress from
   *  syllabus_topic_progress — these columns are read-only caches after this change, never
   *  written independently elsewhere. */
  private async recomputeDerivedCaches(manager: any, topicId: string, chapterIdHint: string | null) {
    const topicAgg = await manager.query(
      `SELECT
         CASE WHEN bool_or(status = 'COMPLETED') THEN 'completed'
              WHEN bool_or(status = 'IN_PROGRESS') THEN 'in_progress'
              ELSE 'pending' END AS status,
         MAX(progress)::int AS progress
       FROM syllabus_topic_progress WHERE topic_id = $1`,
      [topicId],
    );
    await manager.query(`UPDATE topics SET status = $1, progress = $2 WHERE id = $3`, [
      topicAgg[0]?.status || 'pending',
      topicAgg[0]?.progress || 0,
      topicId,
    ]);

    const topicRow = await manager.query(`SELECT chapter_id FROM topics WHERE id = $1`, [topicId]);
    const chapterId = topicRow[0]?.chapter_id || chapterIdHint;
    if (!chapterId) return;

    const chapterStats = await manager.query(
      `SELECT COUNT(*)::int AS total, COUNT(CASE WHEN status = 'completed' OR progress >= 100 THEN 1 END)::int AS done
       FROM topics WHERE chapter_id = $1`,
      [chapterId],
    );
    const chTotal = chapterStats[0]?.total || 1;
    const chDone = chapterStats[0]?.done || 0;
    const chProgress = Math.round((chDone / chTotal) * 100);
    await manager.query(`UPDATE chapters SET progress = $1, status = $2 WHERE id = $3`, [
      chProgress,
      chProgress >= 100 ? 'completed' : chProgress > 0 ? 'in_progress' : 'pending',
      chapterId,
    ]);

    const chapterRow = await manager.query(`SELECT subject_id FROM chapters WHERE id = $1`, [chapterId]);
    const subjectId = chapterRow[0]?.subject_id;
    if (!subjectId) return;

    const subjectStats = await manager.query(
      `SELECT COUNT(DISTINCT t.id)::int AS total, COUNT(DISTINCT CASE WHEN t.status = 'completed' OR t.progress >= 100 THEN t.id END)::int AS done
       FROM topics t JOIN chapters c ON t.chapter_id = c.id WHERE c.subject_id = $1`,
      [subjectId],
    );
    const subTotal = subjectStats[0]?.total || 1;
    const subDone = subjectStats[0]?.done || 0;
    const subProgress = Math.round((subDone / subTotal) * 100);
    await manager.query(`UPDATE subjects SET progress = $1, status = $2 WHERE id = $3`, [
      subProgress,
      subProgress >= 100 ? 'completed' : subProgress > 0 ? 'in_progress' : 'pending',
      subjectId,
    ]);
  }

  /** Formats one planned topic (from chapter_allocations) merged with its live progress row,
   *  in the same shape every existing endpoint has always returned to the frontend. */
  private formatTopicProgress(ch: any, t: any, match: any | undefined) {
    const statusMap: Record<string, string> = { PLANNED: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', DELAYED: 'delayed' };
    return {
      topicId: t.topicId || t.id || null,
      topicName: t.topicName || t.name || 'Topic',
      chapterId: ch.chapterId,
      chapterName: ch.chapterName,
      chapterTerm: ch.term || 'Unit 1',
      status: match ? (statusMap[match.status] || 'pending') : (t.status || 'pending'),
      progress: match ? (match.progress ?? 0) : (t.progress ?? 0),
      plannedPeriods: match?.planned_periods ?? t.plannedPeriods ?? t.periods ?? 1,
      actualPeriods: match?.actual_periods ?? t.actualPeriods ?? 0,
      remarks: match?.remarks ?? t.remarks ?? null,
      delayReason: match?.delay_reason ?? t.delayReason ?? null,
      carryForwardDate: match?.carry_forward_date ? new Date(match.carry_forward_date).toISOString().split('T')[0] : (t.carryForwardDate || null),
      completedAt: match?.completed_at ? new Date(match.completed_at).toISOString() : (t.completedAt || null),
    };
  }

  /**
   * Walks a plan's planning structure (chapterAllocations) merged with its live
   * syllabus_topic_progress rows, returning both the per-topic list and aggregate counts.
   * The single computation every tracker/reporting endpoint uses.
   */
  private async computeTopicsProgress(planId: string, chapterAllocations: any[]) {
    const progressRows: any[] = await this.ds.query(
      `SELECT stp.*, t.name AS db_topic_name, c.name AS db_chapter_name
       FROM syllabus_topic_progress stp
       LEFT JOIN topics t ON t.id = stp.topic_id
       LEFT JOIN chapters c ON c.id = stp.chapter_id
       WHERE stp.syllabus_plan_id = $1`,
      [planId],
    ).catch(() => []);

    const byTopicId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const r of progressRows) {
      if (r.topic_id) byTopicId.set(String(r.topic_id), r);
      if (r.topic_name) byName.set(String(r.topic_name).trim().toLowerCase(), r);
    }

    const consumed = new Set<any>();
    const results: any[] = [];
    (chapterAllocations || []).forEach((ch: any, chIdx: number) => {
      // A chapter with no topics defined yet still represents undone work — count it as
      // one pending item rather than letting it silently disappear from the totals.
      const topics = Array.isArray(ch.topics) && ch.topics.length > 0
        ? ch.topics
        : [{ topicId: `ch-${ch.chapterId || chIdx}`, topicName: `Core Curriculum: ${ch.chapterName}` }];
      topics.forEach((t: any) => {
        const tId = t.topicId ? String(t.topicId) : null;
        const tName = (t.topicName || t.name || '').trim().toLowerCase();
        const match = (tId && byTopicId.get(tId)) || (tName && byName.get(tName));
        if (match) consumed.add(match);
        results.push(this.formatTopicProgress(ch, t, match));
      });
    });

    // A progress row can exist without appearing in chapterAllocations (e.g. a lesson was
    // completed for a topic that isn't part of this plan's allocated structure) — it still
    // counts toward the plan's totals.
    for (const r of progressRows) {
      if (!consumed.has(r)) {
        results.push(this.formatTopicProgress(
          { chapterId: r.chapter_id, chapterName: r.db_chapter_name || 'Unassigned', term: 'Unit 1' },
          { topicId: r.topic_id, topicName: r.topic_name || r.db_topic_name },
          r,
        ));
      }
    }

    const totalTopics = results.length;
    const completedTopics = results.filter((r) => r.status === 'completed').length;
    const inProgressTopics = results.filter((r) => r.status === 'in_progress').length;
    const progressPercentage = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

    return { topics: results, totalTopics, completedTopics, inProgressTopics, progressPercentage };
  }

  /**
   * Institute-agnostic — unlike the tracker endpoints, this scans every plan across every
   * institute in one pass, for the weekly "syllabus behind schedule" notification job.
   * Reuses computeTopicsProgress so this never becomes a 6th independent completion formula.
   */
  async getPlansBehindSchedule(): Promise<Array<{
    planId: string; instituteId: string; teacherId: string | null;
    subjectName: string; className: string; sectionName: string | null;
    plannedCompletionDate: string; progressPercentage: number;
    delayedInProgressTopics: Array<{ topicId: string | null; topicName: string; progress: number }>;
  }>> {
    const overduePlans: any[] = await this.ds.query(
      `SELECT sp.id AS plan_id, sp.institute_id, sp.teacher_id, sp.chapter_allocations, sp.planned_completion_date,
              COALESCE(sub.name, 'Subject') AS subject_name, c.name AS class_name, sec.name AS section_name
       FROM syllabus_plans sp
       LEFT JOIN subjects sub ON sp.subject_id = sub.id
       LEFT JOIN classes c ON (sp.class_id = c.id OR (sp.class_id IS NULL AND sub.class_id = c.id))
       LEFT JOIN sections sec ON sp.section_id = sec.id
       WHERE sp.planned_completion_date < NOW()`,
    ).catch(() => []);

    const results: Array<any> = [];
    for (const row of overduePlans) {
      const allocs = Array.isArray(row.chapter_allocations) ? row.chapter_allocations : [];
      const pp = await this.computeTopicsProgress(row.plan_id, allocs);
      if (pp.progressPercentage >= 100) continue;

      results.push({
        planId: row.plan_id,
        instituteId: row.institute_id,
        teacherId: row.teacher_id,
        subjectName: row.subject_name,
        className: row.class_name || 'Class',
        sectionName: row.section_name || null,
        plannedCompletionDate: row.planned_completion_date,
        progressPercentage: pp.progressPercentage,
        delayedInProgressTopics: pp.topics
          .filter((t: any) => t.status === 'in_progress')
          .map((t: any) => ({ topicId: t.topicId || null, topicName: t.topicName, progress: t.progress })),
      });
    }
    return results;
  }

  // --- 1. ADMIN SYLLABUS PLANNING ---
  async createSyllabusPlan(user: any, body: any) {
    const instituteId = user.instituteId;
    const academicYear = body.academicYear || String(new Date().getFullYear());
    const classIds = Array.isArray(body.classIds) ? body.classIds : [body.classId];
    const sectionIds = Array.isArray(body.sectionIds) ? body.sectionIds : [body.sectionId || null];
    const chapterAllocationsJson = JSON.stringify(body.chapterAllocations || []);

    const insertedPlans: any[] = [];

    for (const cid of classIds) {
      if (!cid) continue;
      for (const sid of sectionIds) {
        // A single atomic upsert instead of SELECT-then-branch: two concurrent requests for the
        // same institute/class/section/subject scope can no longer both pass the check and each
        // insert their own plan — the unique index (migration AddSyllabusPlanScopeUniqueIndex)
        // makes the second one an UPDATE instead of a duplicate row.
        const res = await this.ds.query(
          `INSERT INTO syllabus_plans (
             institute_id, academic_year, class_id, section_id, subject_id, teacher_id,
             planned_start_date, planned_completion_date, planned_periods, priority, term, status, chapter_allocations
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PLANNED', $12)
           ON CONFLICT (institute_id, class_id, COALESCE(section_id::text, ''), subject_id) DO UPDATE SET
             teacher_id = COALESCE(EXCLUDED.teacher_id, syllabus_plans.teacher_id),
             term = COALESCE(EXCLUDED.term, syllabus_plans.term),
             planned_periods = COALESCE(EXCLUDED.planned_periods, syllabus_plans.planned_periods),
             planned_start_date = COALESCE(EXCLUDED.planned_start_date, syllabus_plans.planned_start_date),
             planned_completion_date = COALESCE(EXCLUDED.planned_completion_date, syllabus_plans.planned_completion_date),
             priority = COALESCE(EXCLUDED.priority, syllabus_plans.priority),
             chapter_allocations = EXCLUDED.chapter_allocations,
             updated_at = NOW()
           RETURNING *`,
          [
            instituteId,
            academicYear,
            cid,
            sid,
            body.subjectId,
            body.teacherId || null,
            body.plannedStartDate || new Date(),
            body.plannedCompletionDate || new Date(),
            body.plannedPeriods || 1,
            body.priority || 'NORMAL',
            body.term || 'Annual Plan',
            chapterAllocationsJson
          ]
        );
        insertedPlans.push(res[0]);
      }
    }

    return { success: true, count: insertedPlans.length, data: insertedPlans };
  }

  async getSyllabusPlans(user: any, query: any) {
    const instituteId = user.instituteId;
    const academicYear = query.academicYear;

    let sql = `
      SELECT sp.*, sub.name as subject_name, c.name as class_name, sec.name as section_name,
             u.name as teacher_name
      FROM syllabus_plans sp
      LEFT JOIN subjects sub ON sp.subject_id = sub.id
      LEFT JOIN classes c ON sp.class_id = c.id
      LEFT JOIN sections sec ON sp.section_id = sec.id
      LEFT JOIN teachers t ON (sp.teacher_id = t.id OR sp.teacher_id = t.user_id)
      LEFT JOIN users u ON (t.user_id = u.id OR sp.teacher_id = u.id)
      WHERE sp.institute_id = $1
    `;
    const params: any[] = [instituteId];

    if (academicYear) {
      params.push(academicYear);
      sql += ` AND sp.academic_year = $${params.length}`;
    }

    sql += ` ORDER BY sp.created_at DESC`;
    const rows = await this.ds.query(sql, params);

    // Merge live syllabus_topic_progress into every plan's chapter_allocations here, at
    // the source, so every current and future consumer of this list endpoint sees real
    // status/progress instead of the raw, identity-only JSON column.
    const merged = await Promise.all(rows.map(async (row: any) => ({
      ...row,
      chapter_allocations: await this.mergeChapterAllocationsWithProgress(row.id, row.chapter_allocations),
    })));

    return { success: true, data: merged };
  }

  /**
   * Single-plan fetch with chapter_allocations merged against the live
   * syllabus_topic_progress table (via the same computeTopicsProgress every tracker
   * endpoint uses) — unlike getSyllabusPlans, whose chapter_allocations is the raw,
   * identity-only JSON column that never carries live status/progress. The plan
   * detail page reads this so progress a teacher just saved doesn't appear to
   * revert to "pending" on the next load.
   */
  /**
   * Merges a plan's identity-only chapter_allocations with live per-topic status/progress
   * from syllabus_topic_progress (via computeTopicsProgress) — used everywhere a plan's
   * chapter_allocations is handed to the frontend, so no caller ever shows the raw,
   * always-stale JSON column directly.
   */
  private async mergeChapterAllocationsWithProgress(planId: string, chapterAllocations: any[]) {
    const allocs = Array.isArray(chapterAllocations) ? chapterAllocations : [];
    const { topics: mergedTopics } = await this.computeTopicsProgress(planId, allocs);

    const topicsByChapter = new Map<string, any[]>();
    mergedTopics.forEach((t: any) => {
      const key = String(t.chapterId ?? '');
      if (!topicsByChapter.has(key)) topicsByChapter.set(key, []);
      topicsByChapter.get(key)!.push(t);
    });

    return allocs.map((ch: any) => ({
      ...ch,
      topics: topicsByChapter.get(String(ch.chapterId ?? '')) ?? (Array.isArray(ch.topics) ? ch.topics : []),
    }));
  }

  async getSyllabusPlanById(user: any, id: string) {
    const instituteId = user.instituteId;
    const rows = await this.ds.query(
      `SELECT sp.*, sub.name as subject_name, c.name as class_name, sec.name as section_name,
              COALESCE(u.name, 'Unassigned') as teacher_name
       FROM syllabus_plans sp
       LEFT JOIN subjects sub ON sp.subject_id = sub.id
       LEFT JOIN classes c ON sp.class_id = c.id
       LEFT JOIN sections sec ON sp.section_id = sec.id
       LEFT JOIN teachers t ON (sp.teacher_id = t.id OR sp.teacher_id = t.user_id)
       LEFT JOIN users u ON (t.user_id = u.id OR sp.teacher_id = u.id)
       WHERE sp.id = $1 AND sp.institute_id = $2`,
      [id, instituteId],
    );
    if (!rows.length) throw new NotFoundException('Syllabus plan not found');

    const plan = rows[0];
    plan.chapter_allocations = await this.mergeChapterAllocationsWithProgress(id, plan.chapter_allocations);
    return { success: true, data: plan };
  }

  async updateSyllabusPlan(user: any, id: string, body: any) {
    const instituteId = user.instituteId;
    const chapterAllocationsJson = body.chapterAllocations ? JSON.stringify(body.chapterAllocations) : null;

    await this.ds.query(
      `UPDATE syllabus_plans
       SET teacher_id = COALESCE($2, teacher_id),
           term = COALESCE($3, term),
           planned_periods = COALESCE($4, planned_periods),
           planned_start_date = COALESCE($5, planned_start_date),
           planned_completion_date = COALESCE($6, planned_completion_date),
           priority = COALESCE($7, priority),
           chapter_allocations = COALESCE($9, chapter_allocations),
           updated_at = NOW()
       WHERE id = $1 AND institute_id = $8`,
      [
        id,
        body.teacherId || null,
        body.term || null,
        body.plannedPeriods || null,
        body.plannedStartDate || null,
        body.plannedCompletionDate || null,
        body.priority || null,
        instituteId,
        chapterAllocationsJson
      ]
    );
    return { success: true, message: 'Syllabus plan updated successfully' };
  }

  async deleteSyllabusPlan(user: any, id: string) {
    const instituteId = user.instituteId;
    await this.ds.query(`DELETE FROM syllabus_plans WHERE id = $1 AND institute_id = $2`, [id, instituteId]);
    return { success: true, message: 'Syllabus plan removed successfully' };
  }

  async updateSyllabusPlanProgress(user: any, id: string, body: any) {
    const instituteId = user.instituteId;
    const { chapterAllocations, topicId, status, progress, actualPeriods } = body;

    const existingRows = await this.ds.query(
      `SELECT id, chapter_allocations, subject_id FROM syllabus_plans WHERE id = $1 AND institute_id = $2`,
      [id, instituteId]
    );

    if (existingRows.length === 0) {
      throw new NotFoundException('Syllabus plan not found');
    }

    let currentAllocations = Array.isArray(existingRows[0].chapter_allocations) 
      ? existingRows[0].chapter_allocations 
      : [];

    if (Array.isArray(chapterAllocations)) {
      currentAllocations = chapterAllocations;
    } else if (topicId) {
      // Ensure the topic's identity exists in the planning structure (e.g. it was pulled
      // from the topics catalog rather than the original bulk allocation) — identity only,
      // no progress fields; the actual status/progress write goes through upsertTopicProgress.
      let foundMatch = false;
      currentAllocations = currentAllocations.map((ch: any) => {
        const topics = Array.isArray(ch.topics) ? ch.topics : [];
        const hasMatch = topics.some((t: any) => {
          const tId = String(t.topicId || t.id || '').trim();
          const tName = String(t.topicName || t.name || '').trim().toLowerCase();
          const targetId = String(topicId || '').trim();
          const targetName = String(body.topicName || '').trim().toLowerCase();
          return (tId && targetId && tId === targetId) || (tName && targetName && tName === targetName) || (tName && targetId && tName === targetId.toLowerCase());
        });
        if (hasMatch) foundMatch = true;
        return ch;
      });

      if (!foundMatch && currentAllocations.length > 0) {
        let parentCh = currentAllocations.find((c: any) =>
          (body.chapterId && String(c.chapterId || '').toLowerCase() === String(body.chapterId).toLowerCase()) ||
          (body.chapterName && String(c.chapterName || '').toLowerCase() === String(body.chapterName).toLowerCase())
        );
        if (!parentCh) parentCh = currentAllocations[0];

        const existingTopics = Array.isArray(parentCh.topics) ? parentCh.topics : [];
        parentCh.topics = [...existingTopics, { topicId, topicName: body.topicName || 'Topic' }];
      }

      await this.upsertTopicProgress(
        id,
        { topicId, topicName: body.topicName, chapterId: body.chapterId },
        {
          status,
          progress,
          actualPeriods,
          remarks: body.remarks,
          delayReason: body.delayReason,
          carryForwardDate: body.carryForwardDate,
          updatedBy: user.id,
        },
      );
    }

    const chapterAllocationsJson = JSON.stringify(currentAllocations);

    await this.ds.query(
      `UPDATE syllabus_plans
       SET chapter_allocations = $2,
           updated_at = NOW()
       WHERE id = $1 AND institute_id = $3`,
      [id, chapterAllocationsJson, instituteId]
    );

    const { topics: mergedTopics } = await this.computeTopicsProgress(id, currentAllocations);
    const mergedByKey = new Map<string, any>();
    mergedTopics.forEach((t: any) => {
      if (t.topicId) mergedByKey.set(String(t.topicId), t);
      mergedByKey.set(String(t.topicName || '').trim().toLowerCase(), t);
    });
    const responseAllocations = currentAllocations.map((ch: any) => ({
      ...ch,
      topics: (Array.isArray(ch.topics) ? ch.topics : []).map((t: any) => {
        const merged = (t.topicId && mergedByKey.get(String(t.topicId))) || mergedByKey.get(String(t.topicName || t.name || '').trim().toLowerCase());
        return merged ? { ...t, ...merged, topicId: t.topicId || merged.topicId } : t;
      }),
    }));

    return { success: true, message: 'Syllabus plan progress updated successfully', chapterAllocations: responseAllocations };
  }

  async getSyllabusTracker(user: any, query: any) {
    const instituteId = user.instituteId;

    let subjectRows: any[] = [];
    try {
      subjectRows = await this.ds.query(
        `SELECT 
            sp.id as plan_id,
            sp.subject_id as subject_id,
            sp.chapter_allocations,
            COALESCE(sub.name, 'Subject Plan') as subject_name,
            c.name as class_name,
            c.id as class_id,
            sp.section_id as section_id,
            sec.name as section_name,
            COALESCE(
              MAX(u_plan.name),
              (
                SELECT u.name FROM teacher_academic_assignments taa
                JOIN teachers t ON taa.teacher_id = t.id
                JOIN users u ON t.user_id = u.id
                WHERE taa.subject_id = sp.subject_id AND taa.class_id = c.id
                LIMIT 1
              ),
              'Unassigned'
            ) as teacher_name,
            COALESCE(sp.term, 'Term 1') as term,
            COALESCE(sp.planned_periods, 0) as planned_periods,
            COALESCE(sp.priority, 'NORMAL') as priority,
            sp.planned_start_date,
            sp.planned_completion_date,
            COUNT(DISTINCT ch.id)::int as total_chapters
         FROM syllabus_plans sp
         LEFT JOIN subjects sub ON sp.subject_id = sub.id
         LEFT JOIN classes c ON (sp.class_id = c.id OR (sp.class_id IS NULL AND sub.class_id = c.id))
         LEFT JOIN sections sec ON sp.section_id = sec.id
         LEFT JOIN teachers t_plan ON (sp.teacher_id = t_plan.id OR sp.teacher_id = t_plan.user_id)
         LEFT JOIN users u_plan ON (u_plan.id = t_plan.user_id OR u_plan.id = sp.teacher_id)
         LEFT JOIN chapters ch ON ch.subject_id = sub.id
         WHERE sp.institute_id = $1
         GROUP BY sp.id, sp.subject_id, sp.chapter_allocations, sub.name, c.name, c.id, sp.class_id, sp.section_id, sec.name, sp.term, sp.planned_periods, sp.priority, sp.planned_start_date, sp.planned_completion_date
         ORDER BY c.name NULLS LAST, sub.name`,
        [instituteId]
      );
    } catch (e) {
      console.error('[getSyllabusTracker] Query failed:', e);
      subjectRows = [];
    }

    // Completion percentages are computed from syllabus_topic_progress — the single
    // source of truth — merged onto each plan's planning structure.
    const now = new Date();
    const trackerData = await Promise.all(subjectRows.map(async (row) => {
      const allocs = Array.isArray(row.chapter_allocations) ? row.chapter_allocations : [];
      const pp = await this.computeTopicsProgress(row.plan_id, allocs);

      const startDate = row.planned_start_date ? new Date(row.planned_start_date) : null;
      const completionDate = row.planned_completion_date ? new Date(row.planned_completion_date) : null;
      const isOverdue = completionDate && completionDate.getTime() < now.getTime();

      // Time-elapsed-vs-plan-duration benchmark — same formula getDetailedPlanTracker
      // uses for its own overallPlannedProgress, so "expected" means the same thing
      // everywhere in the app instead of an arbitrary fixed number.
      let expectedProgressPercentage: number | null = null;
      if (startDate && completionDate && completionDate.getTime() > startDate.getTime()) {
        const totalDays = Math.ceil((completionDate.getTime() - startDate.getTime()) / 86400000);
        const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((now.getTime() - startDate.getTime()) / 86400000)));
        expectedProgressPercentage = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
      }

      let status = 'ON_TRACK';
      if (pp.progressPercentage >= 100) {
        status = 'COMPLETED';
      } else if (isOverdue) {
        status = 'BEHIND';
      }

      return {
        planId: row.plan_id,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        classId: row.class_id,
        className: row.class_name,
        sectionId: row.section_id,
        sectionName: row.section_name,
        teacherName: row.teacher_name || 'Unassigned',
        term: row.term || 'Term 1',
        plannedPeriods: row.planned_periods || 0,
        priority: row.priority || 'NORMAL',
        plannedStartDate: row.planned_start_date,
        plannedCompletionDate: row.planned_completion_date,
        expectedProgressPercentage,
        totalChapters: Math.max(allocs.length, row.total_chapters || 0),
        totalTopics: pp.totalTopics,
        completedTopics: pp.completedTopics,
        inProgressTopics: pp.inProgressTopics,
        pendingTopics: Math.max(0, pp.totalTopics - pp.completedTopics - pp.inProgressTopics),
        progressPercentage: pp.progressPercentage,
        status
      };
    }));

    const overallTotal = trackerData.reduce((acc, curr) => acc + curr.totalTopics, 0) || 1;
    const overallCompleted = trackerData.reduce((acc, curr) => acc + curr.completedTopics, 0);
    const overallProgress = Math.round((overallCompleted / overallTotal) * 100);

    return {
      success: true,
      summary: {
        overallProgress,
        totalSubjects: trackerData.length,
        subjectsOnTrack: trackerData.filter(t => t.status === 'ON_TRACK' || t.status === 'COMPLETED').length,
        subjectsBehind: trackerData.filter(t => t.status === 'BEHIND').length
      },
      tracker: trackerData
    };
  }

  async getDetailedPlanTracker(user: any, planId: string) {
    const instituteId = user.instituteId;

    const planRows = await this.ds.query(
      `SELECT sp.*,
              c.name as class_name,
              sec.name as section_name,
              sub.name as subject_name,
              COALESCE(u_plan.name, 'Unassigned') as teacher_name
       FROM syllabus_plans sp
       LEFT JOIN subjects sub ON sp.subject_id = sub.id
       LEFT JOIN classes c ON (sp.class_id = c.id OR (sp.class_id IS NULL AND sub.class_id = c.id))
       LEFT JOIN sections sec ON sp.section_id = sec.id
       LEFT JOIN teachers t_plan ON (sp.teacher_id = t_plan.id OR sp.teacher_id = t_plan.user_id)
       LEFT JOIN users u_plan ON (u_plan.id = t_plan.user_id OR u_plan.id = sp.teacher_id)
       WHERE (sp.id::text = $1 OR sp.subject_id::text = $1) AND sp.institute_id = $2
       LIMIT 1`,
      [planId, instituteId]
    ).catch(() => []);

    const plan = planRows[0];
    if (!plan) {
      throw new NotFoundException('Syllabus plan not found');
    }

    // Load DB chapters and topics for this plan's subject
    const chapters = await this.ds.query(
      `SELECT id, name, sort_order FROM chapters WHERE subject_id = $1 ORDER BY sort_order, created_at`,
      [plan.subject_id]
    ).catch(() => []);

    const topics = await this.ds.query(
      `SELECT t.id, t.name, t.chapter_id, COALESCE(t.sort_order, 0) as sort_order
       FROM topics t
       LEFT JOIN chapters c ON t.chapter_id = c.id
       WHERE c.subject_id = $1
       ORDER BY t.sort_order, t.created_at`,
      [plan.subject_id]
    ).catch(() => []);

    let chapterAllocations = Array.isArray(plan.chapter_allocations) ? plan.chapter_allocations : [];

    if (chapterAllocations.length === 0 && chapters.length > 0) {
      chapterAllocations = chapters.map((ch: any, idx: number) => {
        let term = 'Unit 1';
        const ratio = (idx + 1) / chapters.length;
        if (ratio <= 0.25) term = 'Unit 1';
        else if (ratio <= 0.50) term = 'Term 1';
        else if (ratio <= 0.75) term = 'Unit 2';
        else term = 'Term 2';

        const chTopics = topics.filter((t: any) => t.chapter_id === ch.id).map((t: any) => ({
          topicId: t.id,
          topicName: t.name
        }));

        return {
          chapterId: ch.id,
          chapterName: ch.name,
          term,
          topics: chTopics
        };
      });
    }

    const now = new Date();
    const startDate = plan.planned_start_date ? new Date(plan.planned_start_date) : new Date(Date.now() - 30 * 86400000);
    const endDate = plan.planned_completion_date ? new Date(plan.planned_completion_date) : new Date(Date.now() + 60 * 86400000);

    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))));
    const overallPlannedProgress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

    // Dynamic Topic Calculations — merged with the plan's live syllabus_topic_progress rows,
    // the single source of truth for completion status.
    const { topics: mergedProgress } = await this.computeTopicsProgress(plan.id, chapterAllocations);
    const topicCalculations: any[] = [];
    let completedCount = 0;

    chapterAllocations.forEach((ch: any, chIdx: number) => {
      const chTopics = Array.isArray(ch.topics) && ch.topics.length > 0
        ? ch.topics
        : [{ topicId: `ch-${ch.chapterId || chIdx}`, topicName: `Core Curriculum: ${ch.chapterName}` }];

      chTopics.forEach((t: any, tIdx: number) => {
        const tId = t.topicId ? String(t.topicId) : null;
        const tName = (t.topicName || t.name || '').trim().toLowerCase();
        const merged = mergedProgress.find((m: any) => (tId && String(m.topicId) === tId) || (tName && String(m.topicName || '').trim().toLowerCase() === tName));

        const plannedStart = new Date(startDate.getTime() + (chIdx * 5 + tIdx) * 86400000);
        const plannedEnd = new Date(startDate.getTime() + (chIdx * 5 + tIdx + 4) * 86400000);

        const isCompleted = merged?.status === 'completed';
        const isInProgress = !isCompleted && merged?.status === 'in_progress';

        let status = 'Not Started';
        let actualStartDate: string | null = null;
        let actualCompletionDate = merged?.completedAt ? new Date(merged.completedAt).toISOString().split('T')[0] : null;

        if (isCompleted) {
          status = 'Completed';
          completedCount++;
          if (!actualStartDate) actualStartDate = plannedStart.toISOString().split('T')[0];
          if (!actualCompletionDate) actualCompletionDate = plannedEnd.toISOString().split('T')[0];
        } else if (isInProgress) {
          status = now > plannedEnd ? 'Delayed' : 'In Progress';
          if (!actualStartDate) actualStartDate = new Date(now.getTime() - 2 * 86400000).toISOString().split('T')[0];
        } else {
          status = now > plannedEnd ? 'Delayed' : (now < plannedStart ? 'Scheduled' : 'Planned');
        }

        const plannedPeriods = merged?.plannedPeriods || t.periods || 2;
        const actualPeriods = merged?.actualPeriods || (isCompleted ? plannedPeriods : (isInProgress ? 1 : 0));
        const plannedProgress = Math.min(100, Math.round(((chIdx + 1) / chapterAllocations.length) * 100));
        const actualProgress = isCompleted ? 100 : (isInProgress ? (merged?.progress || 50) : 0);

        let delayInDays = 0;
        if (status === 'Delayed') {
          delayInDays = Math.max(1, Math.ceil((now.getTime() - plannedEnd.getTime()) / (1000 * 60 * 60 * 24)));
        } else if (actualCompletionDate && new Date(actualCompletionDate) > plannedEnd) {
          delayInDays = Math.ceil((new Date(actualCompletionDate).getTime() - plannedEnd.getTime()) / (1000 * 60 * 60 * 24));
        }

        const delayInPeriods = Math.max(0, actualPeriods - plannedPeriods);

        topicCalculations.push({
          id: t.topicId || `t-${chIdx}-${tIdx}`,
          chapterId: ch.chapterId,
          chapterName: ch.chapterName,
          chapterTerm: ch.term || 'Unit 1',
          topicName: t.topicName || t.name,
          status,
          plannedStartDate: plannedStart.toISOString().split('T')[0],
          plannedEndDate: plannedEnd.toISOString().split('T')[0],
          actualStartDate: actualStartDate || '—',
          actualCompletionDate: actualCompletionDate || '—',
          plannedPeriods,
          actualPeriods,
          plannedProgress,
          actualProgress,
          delayInDays,
          delayInPeriods,
          isCompleted,
          isInProgress,
          isDelayed: status === 'Delayed',
          isUpcomingDeadline: !isCompleted && plannedEnd >= now && plannedEnd <= new Date(now.getTime() + 14 * 86400000)
        });
      });
    });

    const overallActualProgress = Math.round((completedCount / Math.max(1, topicCalculations.length)) * 100);

    return {
      success: true,
      plan: {
        id: plan.id,
        academicYear: plan.academic_year || '2025-2026',
        classId: plan.class_id,
        className: plan.class_name || 'Class',
        sectionId: plan.section_id,
        sectionName: plan.section_name || 'All Sections',
        subjectId: plan.subject_id,
        subjectName: plan.subject_name || 'Subject',
        teacherId: plan.teacher_id,
        teacherName: plan.teacher_name || 'Unassigned',
        term: plan.term || 'Annual Plan',
        plannedPeriods: plan.planned_periods || topicCalculations.reduce((a, b) => a + b.plannedPeriods, 0),
        actualPeriods: topicCalculations.reduce((a, b) => a + b.actualPeriods, 0),
        plannedStartDate: plan.planned_start_date ? new Date(plan.planned_start_date).toISOString().split('T')[0] : startDate.toISOString().split('T')[0],
        plannedCompletionDate: plan.planned_completion_date ? new Date(plan.planned_completion_date).toISOString().split('T')[0] : endDate.toISOString().split('T')[0],
        priority: plan.priority || 'NORMAL',
        chapterAllocations,
        overallPlannedProgress,
        overallActualProgress,
        topicCalculations
      }
    };
  }

  async getTeacherTeachingPlan(user: any, query: any) {
    const instituteId = user.instituteId;
    const teacherId = user.id;

    let lessons: any[] = [];
    try {
      lessons = await this.ds.query(
        `SELECT l.*, sub.name as subject_name, c.name as class_name, sec.name as section_name,
                ch.name as chapter_name, top.name as topic_name
         FROM lesson_plans l
         LEFT JOIN subjects sub ON l.subject_id = sub.id
         LEFT JOIN classes c ON l.class_id = c.id
         LEFT JOIN sections sec ON l.section_id = sec.id
         LEFT JOIN chapters ch ON l.chapter_id = ch.id
         LEFT JOIN topics top ON l.topic_id = top.id
         WHERE l.institute_id = $1 AND l.teacher_id = $2
         ORDER BY l.date DESC`,
        [instituteId, teacherId]
      );
    } catch (e) {
      console.error('[getTeacherTeachingPlan.lessons] SQL Error:', e);
    }

    let timetableSlots: any[] = [];
    try {
      const now = new Date();
      const jsDay = now.getDay();
      const dayInt = jsDay === 0 ? 7 : jsDay;
      const todayDayName = now.toLocaleDateString('en-US', { weekday: 'long' });

      timetableSlots = await this.ds.query(
        `SELECT t.*, sub.name as subject_name, sec.name as section_name, c.name as class_name, c.id as class_id
         FROM timetables t
         LEFT JOIN subjects sub ON t.subject_id = sub.id
         LEFT JOIN sections sec ON t.section_id = sec.id
         LEFT JOIN classes c ON sec.class_id = c.id
         WHERE t.institute_id = $1 
           AND (t.teacher_id = $2 OR t.teacher_id = $3) 
           AND (
             t.day_of_week::text = $4 
             OR t.day_of_week::text = $5 
             OR LOWER(t.day_of_week::text) = LOWER($6)
           )
         ORDER BY t.start_time ASC`,
        [instituteId, teacherId, user.user_id || teacherId, String(dayInt), String(jsDay), todayDayName]
      );
    } catch (e) {
      console.error('[getTeacherTeachingPlan.timetable] SQL Error:', e);
    }

    let publishedPlans: any[] = [];
    try {
      const teacherProfileRow = await this.ds.query(`SELECT id FROM teachers WHERE user_id = $1`, [user.id]).catch(() => []);
      const teacherProfileId = teacherProfileRow[0]?.id;

      publishedPlans = await this.ds.query(
        `SELECT sp.*, sub.name as subject_name, c.name as class_name, sec.name as section_name
         FROM syllabus_plans sp
         LEFT JOIN subjects sub ON sp.subject_id = sub.id
         LEFT JOIN classes c ON sp.class_id = c.id
         LEFT JOIN sections sec ON sp.section_id = sec.id
         WHERE sp.institute_id = $1 AND (
           sp.teacher_id = $2 OR sp.teacher_id = $3 OR EXISTS (
             SELECT 1 FROM teacher_academic_assignments taa 
             WHERE taa.subject_id = sp.subject_id AND taa.class_id = sp.class_id 
               AND (taa.teacher_id = $2 OR taa.teacher_id = $3)
           )
         )
         ORDER BY sp.created_at DESC`,
        [instituteId, teacherId, teacherProfileId || teacherId]
      );

      // sp.chapter_allocations is identity-only (topic status/progress lives in
      // syllabus_topic_progress, the source of truth) — merge it in here, otherwise the
      // teacher's own dashboard cards and "Syllabus Topics — Progress Tracker" section
      // (built from this array) show topics as pending forever even after progress
      // has been saved.
      publishedPlans = await Promise.all(publishedPlans.map(async (plan) => ({
        ...plan,
        chapter_allocations: await this.mergeChapterAllocationsWithProgress(plan.id, plan.chapter_allocations),
      })));
    } catch (e) {
      console.error('[getTeacherTeachingPlan.publishedPlans] SQL Error:', e);
    }

    let teacherAssignments: any[] = [];
    try {
      const teacherProfileRow = await this.ds.query(`SELECT id FROM teachers WHERE user_id = $1`, [user.id]).catch(() => []);
      const teacherProfileId = teacherProfileRow[0]?.id;

      teacherAssignments = await this.ds.query(
        `SELECT DISTINCT class_id, class_name, section_id, section_name, subject_id, subject_name FROM (
           SELECT taa.class_id, c.name as class_name, taa.section_id, sec.name as section_name, taa.subject_id, sub.name as subject_name
           FROM teacher_academic_assignments taa
           LEFT JOIN classes c ON taa.class_id = c.id
           LEFT JOIN sections sec ON taa.section_id = sec.id
           LEFT JOIN subjects sub ON taa.subject_id = sub.id
           LEFT JOIN teachers t ON taa.teacher_id = t.id
           WHERE (t.user_id = $1 OR taa.teacher_id = $1 OR taa.teacher_id = $2)

           UNION ALL

           SELECT sec.class_id, c.name as class_name, tt.section_id, sec.name as section_name, tt.subject_id, sub.name as subject_name
           FROM timetables tt
           LEFT JOIN sections sec ON tt.section_id = sec.id
           LEFT JOIN classes c ON sec.class_id = c.id
           LEFT JOIN subjects sub ON tt.subject_id = sub.id
           LEFT JOIN teachers t ON tt.teacher_id = t.id
           WHERE (t.user_id = $1 OR tt.teacher_id = $1 OR tt.teacher_id = $2)

           UNION ALL

           SELECT sp.class_id, c.name as class_name, sp.section_id, sec.name as section_name, sp.subject_id, sub.name as subject_name
           FROM syllabus_plans sp
           LEFT JOIN classes c ON sp.class_id = c.id
           LEFT JOIN sections sec ON sp.section_id = sec.id
           LEFT JOIN subjects sub ON sp.subject_id = sub.id
           LEFT JOIN teachers t ON sp.teacher_id = t.id
           WHERE (t.user_id = $1 OR sp.teacher_id = $1 OR sp.teacher_id = $2)
         ) combined
         WHERE class_name IS NOT NULL`,
        [teacherId, teacherProfileId || teacherId]
      );
    } catch (e) {
      console.error('[getTeacherTeachingPlan.assignments] SQL Error:', e);
    }

    // Intentionally a different metric than syllabus completion (computeTopicsProgress):
    // this is "how many of my own lesson_plans rows are marked complete," not "how much of
    // the syllabus is covered." Keep it that way rather than reconciling it with the plan
    // progress helper.
    const completed = lessons.filter(l => l.status === 'COMPLETED').length;
    const total = lessons.length || 1;
    const completionPercentage = Math.round((completed / total) * 100);

    return {
      success: true,
      summary: {
        totalLessons: lessons.length,
        completedLessons: completed,
        pendingLessons: lessons.filter(l => l.status !== 'COMPLETED').length,
        completionPercentage
      },
      publishedPlans,
      todayTimetable: timetableSlots,
      lessons,
      teacherAssignments
    };
  }

  async createLessonPlan(user: any, body: any) {
    const instituteId = user.instituteId;
    const teacherId = user.id;

    // Resolve which syllabus plan this lesson covers so completeLessonPlan can update
    // exactly that plan's progress instead of guessing by subject+class later. Purely
    // additive/best-effort — the lesson form has no plan-id field, so this is inferred
    // server-side and left NULL if nothing matches.
    const planMatch = await this.ds.query(
      `SELECT id FROM syllabus_plans
       WHERE institute_id = $1 AND subject_id = $2 AND class_id = $3 AND (section_id = $4 OR section_id IS NULL)
       ORDER BY (section_id IS NOT NULL) DESC, created_at DESC
       LIMIT 1`,
      [instituteId, body.subjectId, body.classId, body.sectionId || null]
    ).catch(() => []);
    const syllabusPlanId = planMatch[0]?.id || null;

    const res = await this.ds.query(
      `INSERT INTO lesson_plans (
         institute_id, academic_year, class_id, section_id, subject_id, chapter_id, topic_id, syllabus_plan_id, teacher_id,
         date, duration_periods, learning_objectives, previous_knowledge, teaching_methodology,
         teaching_activities, teaching_resources, digital_resources, classroom_activities,
         assessment_method, homework, expected_learning_outcomes, teacher_notes, timetable_id, status, ai_brief
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       RETURNING *`,
      [
        instituteId,
        body.academicYear || String(new Date().getFullYear()),
        body.classId,
        body.sectionId,
        body.subjectId,
        body.chapterId || null,
        body.topicId || null,
        syllabusPlanId,
        teacherId,
        body.date || new Date(),
        body.durationPeriods || 1,
        body.learningObjectives || '',
        body.previousKnowledge || '',
        body.teachingMethodology || 'Interactive Explanation & Chalk-board',
        body.teachingActivities || '',
        body.teachingResources || 'Textbook, Board',
        body.digitalResources || '',
        body.classroomActivities || '',
        body.assessmentMethod || 'Q&A Check',
        body.homework || '',
        body.expectedLearningOutcomes || '',
        body.teacherNotes || '',
        body.timetableId || null,
        body.status || 'SCHEDULED',
        body.aiBrief || null
      ]
    );

    return { success: true, data: res[0] };
  }

  async getLessonPlanById(user: any, id: string) {
    const rows = await this.ds.query(
      `SELECT l.*, sub.name as subject_name, c.name as class_name, sec.name as section_name,
              ch.name as chapter_name, top.name as topic_name
       FROM lesson_plans l
       LEFT JOIN subjects sub ON l.subject_id = sub.id
       LEFT JOIN classes c ON l.class_id = c.id
       LEFT JOIN sections sec ON l.section_id = sec.id
       LEFT JOIN chapters ch ON l.chapter_id = ch.id
       LEFT JOIN topics top ON l.topic_id = top.id
       WHERE l.id = $1 AND l.institute_id = $2 AND l.teacher_id = $3`,
      [id, user.instituteId, user.id],
    );
    if (!rows.length) throw new NotFoundException('Lesson plan not found');
    return { success: true, data: rows[0] };
  }

  async generateAiLessonTemplate(user: any, body: any) {
    let subjectName = body.subjectName || '';
    let chapterName = body.chapterName || '';
    let topicName = body.topicName || '';
    const className = body.className || 'Class';

    if (body.subjectId && !subjectName) {
      const subRow = await this.ds.query(`SELECT name FROM subjects WHERE id = $1`, [body.subjectId]).catch(() => []);
      subjectName = subRow[0]?.name || 'Subject';
    }

    if (body.chapterId && !chapterName) {
      const chRow = await this.ds.query(`SELECT name FROM chapters WHERE id = $1`, [body.chapterId]).catch(() => []);
      chapterName = chRow[0]?.name || '';
    }

    if (body.subjectId && !chapterName) {
      const chRows = await this.ds.query(
        `SELECT name FROM chapters WHERE subject_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [body.subjectId]
      ).catch(() => []);
      chapterName = chRows[0]?.name || '';
    }

    const focusTitle = topicName || chapterName || subjectName || 'Core Curriculum';

    // Real AI generation via the same Groq-backed pipeline that powers the school's
    // AI study-material generator (school-material.service.ts) — not a local/dormant
    // LLM path. Falls back to a canned template if the AI service is unreachable or
    // returns nothing usable, so a teacher always gets something to work from.
    try {
      const instRows = await this.ds.query(`SELECT board FROM institutes WHERE id = $1`, [user.instituteId]).catch(() => []);
      const board = instRows[0]?.board || 'CBSE';

      const result = await this.aiBridgeService.generateTopicContent(
        {
          topicName: focusTitle,
          subjectName,
          chapterName,
          contentType: 'lesson_brief',
          difficulty: 'intermediate',
          length: 'standard',
          examTarget: className || 'School',
          courseName: className ? `${className} ${subjectName}`.trim() : 'School',
        },
        user.instituteId,
        'school',
        board,
      );

      if (result?.content) {
        // The model occasionally prefixes/suffixes the markdown with a stray brace or
        // code-fence marker (a JSON-mode habit leaking into markdown output) — strip it.
        const brief = result.content.replace(/^[\s{}`]+/, '').replace(/[\s{}`]+$/, '');
        return {
          success: true,
          isTemplate: true,
          aiGenerated: true,
          message: `AI-generated brief ready for "${focusTitle}". Review before class.`,
          data: { brief },
        };
      }
    } catch (err: any) {
      console.error('[generateAiLessonTemplate] AI bridge call failed, falling back to canned template:', err.message);
    }

    const draftTemplate = {
      learningObjectives: `1. Understand the core principles of "${focusTitle}" in ${className} ${subjectName}.\n2. Apply formulas and fundamental concepts to solve textbook exercises.\n3. Solve standard practice problems on ${focusTitle}.`,
      previousKnowledge: `Students should be familiar with basic prerequisite concepts of ${subjectName} prior to studying ${focusTitle}.`,
      teachingMethodology: 'Interactive Demonstration, Blackboard Breakdown, and Guided Problem Solving',
      teachingActivities: `1. Warm-up & Recall (5 mins): Review prerequisite concepts for ${focusTitle}.\n2. Concept Explanation (20 mins): Step-by-step breakdown of ${focusTitle}.\n3. Worked Examples (10 mins): Solving 2 board problems on ${focusTitle}.\n4. Q&A & Summary (5 mins).`,
      teachingResources: `Standard ${subjectName} Textbook, Whiteboard/Smartboard, Chapter Diagram Worksheets`,
      digitalResources: `EDDVA Smart Video Explanation & Interactive Quiz on ${focusTitle}`,
      classroomActivities: `Group Discussion & Pair Problem Solving on ${focusTitle}`,
      assessmentMethod: `Quick 3-question Check on ${focusTitle} at the end of class`,
      homework: `Complete textbook exercise questions for ${chapterName ? `Chapter "${chapterName}"` : focusTitle}`,
      expectedLearningOutcomes: `Students can independently explain ${focusTitle} and solve standard exercises.`,
      teacherNotes: `Note: Reserve 5 minutes for student doubts on ${focusTitle}.`
    };

    return {
      success: true,
      isTemplate: true,
      aiGenerated: false,
      message: `AI is unavailable right now — using a standard template for "${focusTitle}". Personalize before class.`,
      data: draftTemplate
    };
  }

  async completeLessonPlan(user: any, lessonId: string, body: any) {
    let lessonRows: any[] = await this.ds.query(`SELECT * FROM lesson_plans WHERE id::text = $1`, [lessonId]).catch(() => []);
    let l = lessonRows[0];

    if (!l) {
      // Dynamic fallback if lesson was launched directly from timetable or target milestone
      const newPlanRes = await this.ds.query(
        `INSERT INTO lesson_plans (
           institute_id, class_id, section_id, subject_id, teacher_id, date, status, learning_objectives
         ) VALUES ($1, $2, $3, $4, $5, NOW(), 'COMPLETED', $6)
         RETURNING *`,
        [
          user.instituteId,
          body.classId || null,
          body.sectionId || null,
          body.subjectId || null,
          user.id,
          body.topicsCovered || 'Classroom Lesson'
        ]
      ).catch(() => []);
      l = newPlanRes[0] || { id: lessonId, duration_periods: 1 };
      if (l.id) lessonId = l.id;
    }

    // Safely parse rating into integer
    let ratingInt = 4;
    if (typeof body.studentUnderstandingRating === 'number') {
      ratingInt = body.studentUnderstandingRating;
    } else if (typeof body.studentUnderstandingRating === 'string') {
      const parsed = parseInt(body.studentUnderstandingRating, 10);
      if (!isNaN(parsed)) {
        ratingInt = parsed;
      } else {
        const s = body.studentUnderstandingRating.toLowerCase();
        if (s.includes('excellent')) ratingInt = 5;
        else if (s.includes('good')) ratingInt = 4;
        else if (s.includes('average')) ratingInt = 3;
        else if (s.includes('needs')) ratingInt = 2;
        else if (s.includes('poor')) ratingInt = 1;
      }
    }

    // 1. Record Completion
    const completionRes = await this.ds.query(
      `INSERT INTO lesson_completions (
         lesson_plan_id, actual_date, actual_duration_periods, topics_covered, learning_objectives_achieved,
         student_understanding_rating, homework_assigned, assessment_conducted, teacher_reflection,
         completion_type, delay_reason, carry_forward_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        lessonId,
        body.actualDate || new Date(),
        body.actualDurationPeriods || l.duration_periods || 1,
        body.topicsCovered || l.learning_objectives || 'Classroom Lesson',
        body.learningObjectivesAchieved || l.expected_learning_outcomes || 'Concepts Delivered',
        ratingInt,
        body.homeworkAssigned || l.homework || '',
        body.assessmentConducted || l.assessment_method || '',
        body.teacherReflection || body.additionalRemarks || '',
        body.completionType || 'FULLY',
        body.delayReason || null,
        body.carryForwardDate || null
      ]
    ).catch(err => {
      console.error('[completeLessonPlan.completionInsert] Warning:', err.message);
      return [{ id: lessonId, completion_type: body.completionType || 'FULLY' }];
    });

    // Update Lesson Plan Status
    await this.ds.query(`UPDATE lesson_plans SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [lessonId]);

    // Deliberately does NOT touch syllabus_topic_progress. Lesson Plan is a teacher's own
    // pre-class prep note (typically AI-generated) plus a personal record of what was actually
    // taught — decoupled from syllabus completion tracking by design. Marking a topic's
    // progress is a separate, explicit action in Syllabus Planner / My Teaching Plan
    // (updateSyllabusPlanProgress), so a quick lesson-brief workflow can't silently move the
    // syllabus needle behind an admin's back.
    return {
      success: true,
      completion: completionRes[0],
    };
  }

  // --- 3. STUDENT & PARENT READ-ONLY PROGRESS ---
  async getStudentSyllabusProgress(user: any, studentId: string) {
    const stRows: any[] = await this.ds.query(
      `SELECT s.id, s.section_id, sec.class_id, c.name as class_name, sec.name as section_name
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.id = $1 OR s.user_id = $1`,
      [studentId]
    );
    if (!stRows.length) return { success: true, subjects: [] };
    const st = stRows[0];

    const subjects: any[] = await this.ds.query(
      `SELECT sub.id as subject_id, sub.name as subject_name,
              COUNT(DISTINCT ch.id)::int as total_chapters
       FROM subjects sub
       LEFT JOIN chapters ch ON ch.subject_id = sub.id
       WHERE sub.class_id = $1
       GROUP BY sub.id, sub.name ORDER BY sub.name`,
      [st.class_id]
    );

    // Progress must come from this student's OWN section's syllabus_plan (via
    // syllabus_topic_progress, the single source of truth) — not the catalog-level
    // topics.status cache, which is a GLOBAL per-topic value shared by every section
    // teaching that subject. Reading the cache directly would show a student progress
    // another section's teacher made on the same catalog topic in their own plan.
    const progressList = await Promise.all(subjects.map(async (sub) => {
      const planRows = await this.ds.query(
        `SELECT id, chapter_allocations FROM syllabus_plans
         WHERE class_id = $1 AND subject_id = $2 AND (section_id = $3 OR section_id IS NULL)
         ORDER BY (section_id IS NOT NULL) DESC, created_at DESC
         LIMIT 1`,
        [st.class_id, sub.subject_id, st.section_id],
      ).catch(() => []);

      let totalTopics = 0;
      let completedTopics = 0;
      if (planRows.length) {
        const pp = await this.computeTopicsProgress(planRows[0].id, planRows[0].chapter_allocations);
        totalTopics = pp.totalTopics;
        completedTopics = pp.completedTopics;
      }

      return {
        subjectId: sub.subject_id,
        subjectName: sub.subject_name,
        className: st.class_name,
        sectionName: st.section_name,
        totalChapters: sub.total_chapters,
        totalTopics,
        completedTopics,
        progressPercentage: totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0
      };
    }));

    return { success: true, student: st, subjects: progressList };
  }

  async getParentChildSyllabusProgress(user: any, childId: string) {
    return this.getStudentSyllabusProgress(user, childId);
  }

  // --- 4. TEMPLATES & AUDIT ---
  async getLessonTemplates(user: any) {
    const templates: any[] = await this.ds.query(
      `SELECT * FROM lesson_templates WHERE institute_id = $1 OR is_global = TRUE ORDER BY created_at DESC`,
      [user.instituteId]
    );
    return { success: true, data: templates };
  }

  async createLessonTemplate(user: any, body: any) {
    const res = await this.ds.query(
      `INSERT INTO lesson_templates (institute_id, teacher_id, title, category, content_json, is_global)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.instituteId, user.id, body.title, body.category || 'Standard', JSON.stringify(body.contentJson || {}), body.isGlobal || false]
    );
    return { success: true, data: res[0] };
  }
}
