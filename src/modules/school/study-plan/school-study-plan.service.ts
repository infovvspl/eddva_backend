import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiBridgeService } from '../../ai-bridge/ai-bridge.service';

@Injectable()
export class SchoolStudyPlanService implements OnModuleInit {
  private readonly logger = new Logger(SchoolStudyPlanService.name);
  private tablesReady = false;

  constructor(
    @InjectDataSource('school') private readonly ds: DataSource,
    private readonly aiBridgeService: AiBridgeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
  }

  private async ensureTables(): Promise<void> {
    if (this.tablesReady) return;
    try {
      await this.ds.query(`
        ALTER TABLE students ADD COLUMN IF NOT EXISTS xp_total INT DEFAULT 0;

        CREATE TABLE IF NOT EXISTS school_study_plans (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          class_id UUID NOT NULL,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          valid_until TIMESTAMPTZ,
          is_valid BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_school_study_plans_student ON school_study_plans (student_id);

        CREATE TABLE IF NOT EXISTS school_plan_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          study_plan_id UUID NOT NULL REFERENCES school_study_plans(id) ON DELETE CASCADE,
          scheduled_date DATE NOT NULL,
          type VARCHAR NOT NULL,
          title VARCHAR NOT NULL,
          duration_minutes INTEGER NOT NULL DEFAULT 30,
          xp_reward INTEGER NOT NULL DEFAULT 10,
          status VARCHAR NOT NULL DEFAULT 'pending',
          subject_name VARCHAR,
          content_json JSONB,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_school_plan_items_plan ON school_plan_items (study_plan_id);
        CREATE INDEX IF NOT EXISTS idx_school_plan_items_date ON school_plan_items (scheduled_date);

        CREATE TABLE IF NOT EXISTS school_ai_study_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          topic_id UUID NOT NULL,
          lesson_markdown TEXT,
          key_concepts JSONB DEFAULT '[]',
          formulas JSONB DEFAULT '[]',
          practice_questions JSONB DEFAULT '[]',
          common_mistakes JSONB DEFAULT '[]',
          conversation JSONB DEFAULT '[]',
          is_completed BOOLEAN DEFAULT FALSE,
          time_spent_seconds INTEGER DEFAULT 0,
          completed_at TIMESTAMPTZ,
          ai_session_ref VARCHAR,
          highlights JSONB DEFAULT '[]',
          inline_comments JSONB DEFAULT '[]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_school_ai_study_sessions_student ON school_ai_study_sessions (student_id);
        CREATE INDEX IF NOT EXISTS idx_school_ai_study_sessions_topic ON school_ai_study_sessions (topic_id);

        CREATE TABLE IF NOT EXISTS school_topic_progress (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          student_id UUID NOT NULL,
          topic_id UUID NOT NULL,
          status VARCHAR NOT NULL DEFAULT 'unlocked',
          best_accuracy INTEGER DEFAULT 0,
          studied_with_ai BOOLEAN DEFAULT FALSE,
          completed_at TIMESTAMPTZ,
          unlocked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_school_topic_progress_student_topic ON school_topic_progress (student_id, topic_id);

        ALTER TABLE school_topic_progress ADD COLUMN IF NOT EXISTS revision_accuracy INTEGER;
        ALTER TABLE school_topic_progress ADD COLUMN IF NOT EXISTS last_revised_at TIMESTAMPTZ;
        ALTER TABLE school_topic_progress ADD COLUMN IF NOT EXISTS revision_attempt_count INTEGER DEFAULT 0;
      `);
      this.tablesReady = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${(err as Error)?.message}`);
    }
  }

  private todayIst(): string {
    const d = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(d.getTime() + istOffset);
    return istDate.toISOString().split('T')[0];
  }

  private async getStudentProfile(userId: string) {
    const rows = await this.ds.query(
      `SELECT s.id AS student_id, s.user_id, s.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name, s.created_at
       FROM students s
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       WHERE s.user_id = $1`,
      [userId]
    );
    if (!rows.length) {
      throw new NotFoundException('Student profile not found');
    }
    return rows[0];
  }

  private revisionIntervalDays(accuracy: number): 0 | 1 | 3 | 7 | 21 {
    if (accuracy < 40) return 1;
    if (accuracy < 55) return 3;
    if (accuracy < 65) return 7;
    if (accuracy < 75) return 21;
    return 0;
  }

  async getCourses(user: any) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);

    const planRows = await this.ds.query(
      `SELECT id, generated_at, valid_until, is_valid FROM school_study_plans 
       WHERE student_id = $1 AND class_id = $2
       ORDER BY generated_at DESC LIMIT 1`,
      [student.student_id, student.class_id]
    );
    const plan = planRows[0] || null;

    return [
      {
        batchId: student.class_id,
        batchName: `${student.class_name} - Section ${student.section_name}`,
        examTarget: 'School',
        thumbnailUrl: null,
        enrolledAt: student.created_at || new Date(),
        plan: plan ? {
          id: plan.id,
          generatedAt: plan.generated_at,
          validUntil: plan.valid_until,
          isValid: plan.is_valid && (plan.valid_until ? new Date(plan.valid_until) > new Date() : true)
        } : null
      }
    ];
  }

  async generatePlan(user: any, classId?: string, force = false) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    if (force) {
      await this.clearPlan(user, targetClassId);
    } else {
      const existing = await this.ds.query(
        `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
        [student.student_id, targetClassId]
      );
      if (existing.length) {
        return { message: 'Plan already exists.' };
      }
    }

    // Fetch subjects assigned to this student's class/section. Use the curriculum
    // table as the source of truth; teacher assignment rows can be incomplete or
    // point to same-named subject rows from another class during setup.
    const subjects = await this.ds.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM subjects sub
       WHERE sub.class_id::text = $1::text
         AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       UNION
       SELECT DISTINCT scoped.id, scoped.name
       FROM teacher_academic_assignments taa
       JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
       JOIN subjects scoped
         ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
        AND scoped.class_id::text = $1::text
        AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
       WHERE taa.class_id::text = $1::text
         AND taa.section_id::text = $2::text
       ORDER BY name`,
      [targetClassId, student.section_id]
    );

    const subjectIds = subjects.map(s => s.id);
    if (!subjectIds.length) {
      throw new BadRequestException('No subjects assigned to your section.');
    }

    // Fetch chapters and topics
    const topics = await this.ds.query(
      `SELECT t.id AS topic_id, t.name AS topic_name, chap.name AS chapter_name, sub.name AS subject_name, sub.id AS subject_id
       FROM topics t
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE sub.id = ANY($1)
       ORDER BY sub.name, chap.sort_order, chap.name, t.sort_order, t.name`,
      [subjectIds]
    );

    if (!topics.length) {
      throw new BadRequestException('No topics found in curriculum.');
    }

    // Determine weak subjects from past assessments
    const weakSubjectRows = await this.ds.query(
      `SELECT sub.id AS subject_id, sub.name AS subject_name,
              AVG(CASE WHEN r.percentage IS NOT NULL THEN r.percentage
                       WHEN r.total_marks > 0 THEN (r.marks_obtained::numeric / r.total_marks) * 100
                       ELSE 0 END) AS avg_pct
       FROM results r
       JOIN assessments a ON a.id = r.assessment_id
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE r.student_id = $1
       GROUP BY sub.id, sub.name
       HAVING AVG(CASE WHEN r.percentage IS NOT NULL THEN r.percentage
                       WHEN r.total_marks > 0 THEN (r.marks_obtained::numeric / r.total_marks) * 100
                       ELSE 0 END) < 60`,
      [student.user_id]
    );
    const weakSubjectIds = new Set(weakSubjectRows.map(r => r.subject_id));

    // Round-robin distribution prioritising weak subjects
    const prioritizedQueue = [
      ...topics.filter(t => weakSubjectIds.has(t.subject_id)),
      ...topics.filter(t => !weakSubjectIds.has(t.subject_id))
    ];

    const todayStr = this.todayIst();
    const startDate = new Date(todayStr);

    const planRows = await this.ds.query(
      `INSERT INTO school_study_plans (student_id, class_id, valid_until)
       VALUES ($1, $2, $3) RETURNING id`,
      [student.student_id, targetClassId, new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)]
    );
    const planId = planRows[0].id;

    for (let day = 0; day < 30; day++) {
      const topicIndex = day % prioritizedQueue.length;
      const topic = prioritizedQueue[topicIndex];

      const currentDay = new Date(startDate);
      currentDay.setDate(startDate.getDate() + day);
      const dateStr = currentDay.toISOString().split('T')[0];

      // Lecture / study task
      await this.ds.query(
        `INSERT INTO school_plan_items (study_plan_id, scheduled_date, type, title, duration_minutes, xp_reward, subject_name, content_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [planId, dateStr, 'lecture', `Study: ${topic.topic_name}`, 30, 10, topic.subject_name, JSON.stringify({
          topicId: topic.topic_id,
          topicName: topic.topic_name,
          chapterName: topic.chapter_name,
          subjectId: topic.subject_id,
          subjectName: topic.subject_name
        })]
      );

      // Practice task
      await this.ds.query(
        `INSERT INTO school_plan_items (study_plan_id, scheduled_date, type, title, duration_minutes, xp_reward, subject_name, content_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [planId, dateStr, 'practice', `Practice: ${topic.topic_name}`, 30, 15, topic.subject_name, JSON.stringify({
          topicId: topic.topic_id,
          topicName: topic.topic_name,
          chapterName: topic.chapter_name,
          subjectId: topic.subject_id,
          subjectName: topic.subject_name
        })]
      );
    }

    return { message: 'Plan generated successfully!' };
  }

  async clearPlan(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const plans = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );

    for (const plan of plans) {
      await this.ds.query(`DELETE FROM school_plan_items WHERE study_plan_id = $1`, [plan.id]);
      await this.ds.query(`DELETE FROM school_study_plans WHERE id = $1`, [plan.id]);
    }
    return { message: 'Plan cleared successfully.' };
  }

  async getToday(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const planRows = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );
    if (!planRows.length) return [];
    const planId = planRows[0].id;
    const todayStr = this.todayIst();

    const items = await this.ds.query(
      `SELECT id, scheduled_date AS date, type, title, duration_minutes AS "durationMinutes", xp_reward AS "xpReward", status, subject_name AS "subjectName", content_json AS content, completed_at AS "completedAt"
       FROM school_plan_items
       WHERE study_plan_id = $1 AND scheduled_date = $2
       ORDER BY id`,
      [planId, todayStr]
    );
    return items.map((i: any) => ({ ...i, content: typeof i.content === 'string' ? JSON.parse(i.content) : i.content }));
  }

  async getRange(user: any, startDate: string, endDate: string, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const planRows = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );
    if (!planRows.length) return {};
    const planId = planRows[0].id;

    const items = await this.ds.query(
      `SELECT id, scheduled_date AS date, type, title, duration_minutes AS "durationMinutes", xp_reward AS "xpReward", status, subject_name AS "subjectName", content_json AS content, completed_at AS "completedAt"
       FROM school_plan_items
       WHERE study_plan_id = $1 AND scheduled_date >= $2 AND scheduled_date <= $3
       ORDER BY scheduled_date, id`,
      [planId, startDate, endDate]
    );

    const resolved = items.map((i: any) => {
      const content = typeof i.content === 'string' ? JSON.parse(i.content) : i.content;
      const dateStr = typeof i.date === 'string' ? i.date : new Date(i.date).toISOString().split('T')[0];
      return { ...i, date: dateStr, content };
    });

    return resolved.reduce((acc: any, item: any) => {
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
  }

  async completeItem(user: any, itemId: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const items = await this.ds.query(`SELECT id, type, xp_reward, status FROM school_plan_items WHERE id = $1`, [itemId]);
    if (!items.length) throw new NotFoundException('Plan item not found');
    const item = items[0];

    if (item.status !== 'completed') {
      await this.ds.query(`UPDATE school_plan_items SET status = 'completed', completed_at = NOW() WHERE id = $1`, [itemId]);
      await this.ds.query(`UPDATE students SET xp_total = COALESCE(xp_total, 0) + $1 WHERE id = $2`, [item.xp_reward, student.student_id]);
    }
    return { success: true, xpAwarded: item.xp_reward };
  }

  async skipItem(user: any, itemId: string) {
    await this.ensureTables();
    const items = await this.ds.query(`SELECT id, study_plan_id, type, title, duration_minutes, xp_reward, subject_name, content_json, scheduled_date FROM school_plan_items WHERE id = $1`, [itemId]);
    if (!items.length) throw new NotFoundException('Plan item not found');
    const item = items[0];

    await this.ds.query(`UPDATE school_plan_items SET status = 'skipped' WHERE id = $1`, [itemId]);

    const nextDate = new Date(item.scheduled_date);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = nextDate.toISOString().split('T')[0];

    await this.ds.query(
      `INSERT INTO school_plan_items (study_plan_id, scheduled_date, type, title, duration_minutes, xp_reward, subject_name, content_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [item.study_plan_id, nextDateStr, item.type, item.title, item.duration_minutes, item.xp_reward, item.subject_name, item.content_json]
    );
    return { success: true };
  }

  async getNextAction(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const planRows = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );
    if (!planRows.length) return null;
    const planId = planRows[0].id;
    const todayStr = this.todayIst();

    const items = await this.ds.query(
      `SELECT id, scheduled_date AS date, type, title, duration_minutes AS "durationMinutes", xp_reward AS "xpReward", status, subject_name AS "subjectName", content_json AS content, completed_at AS "completedAt"
       FROM school_plan_items
       WHERE study_plan_id = $1 AND scheduled_date = $2 AND status = 'pending'
       ORDER BY id LIMIT 1`,
      [planId, todayStr]
    );
    if (!items.length) return null;
    const i = items[0];
    return { ...i, content: typeof i.content === 'string' ? JSON.parse(i.content) : i.content };
  }

  async getRevisionSpaced(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const completedItems = await this.ds.query(
      `SELECT content_json AS content, MAX(completed_at) AS last_completed
       FROM school_plan_items pi
       JOIN school_study_plans p ON pi.study_plan_id = p.id
       WHERE p.student_id = $1 AND p.class_id = $2 AND pi.status = 'completed' AND pi.content_json IS NOT NULL
       GROUP BY content_json`,
      [student.student_id, targetClassId]
    );

    const topicMap = new Map<string, {
      topicId: string;
      topicName: string;
      chapterName: string;
      subjectName: string;
      accuracy: number;
      attemptCount: number;
      lastStudiedAt: Date;
    }>();

    const now = new Date();
    for (const row of completedItems) {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      if (!content.topicId) continue;

      const lastCompleted = new Date(row.last_completed);
      const existing = topicMap.get(content.topicId);
      if (existing && existing.lastStudiedAt >= lastCompleted) continue;
      topicMap.set(content.topicId, {
        topicId: content.topicId,
        topicName: content.topicName,
        chapterName: content.chapterName || '',
        subjectName: content.subjectName || '',
        accuracy: 65,
        attemptCount: 1,
        lastStudiedAt: lastCompleted,
      });
    }

    const progressRows = await this.ds.query(
      `SELECT tp.topic_id,
              COALESCE(tp.revision_accuracy, tp.best_accuracy, 65) AS accuracy,
              COALESCE(tp.last_revised_at, tp.completed_at) AS last_studied_at,
              COALESCE(tp.revision_attempt_count, 0) AS attempt_count,
              t.name AS topic_name,
              chap.name AS chapter_name,
              sub.name AS subject_name
        FROM school_topic_progress tp
        JOIN topics t ON t.id = tp.topic_id
        JOIN chapters chap ON chap.id = t.chapter_id
        JOIN subjects sub ON sub.id = chap.subject_id
        WHERE tp.student_id = $1 AND COALESCE(tp.last_revised_at, tp.completed_at) IS NOT NULL
          AND (
            (sub.class_id::text = $2::text AND (sub.section_id IS NULL OR sub.section_id::text = $3::text))
            OR sub.id::text IN (
              SELECT DISTINCT scoped.id::text
              FROM teacher_academic_assignments taa
              JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
              JOIN subjects scoped
                ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
               AND scoped.class_id::text = $2::text
               AND (scoped.section_id IS NULL OR scoped.section_id::text = $3::text)
              WHERE taa.class_id::text = $2::text AND taa.section_id::text = $3::text
            )
          ) `,
      [student.student_id, targetClassId, student.section_id]
    );

    for (const row of progressRows) {
      const lastStudiedAt = new Date(row.last_studied_at);
      const existing = topicMap.get(row.topic_id);
      if (existing && existing.lastStudiedAt > lastStudiedAt) {
        existing.accuracy = Number(row.accuracy ?? existing.accuracy);
        existing.attemptCount = Math.max(existing.attemptCount, Number(row.attempt_count ?? 0));
        continue;
      }
      topicMap.set(row.topic_id, {
        topicId: row.topic_id,
        topicName: row.topic_name,
        chapterName: row.chapter_name || '',
        subjectName: row.subject_name || '',
        accuracy: Number(row.accuracy ?? 65),
        attemptCount: Math.max(1, Number(row.attempt_count ?? 0)),
        lastStudiedAt,
      });
    }

    const spacedTopics = [];
    for (const topic of topicMap.values()) {
      const intervalDays = this.revisionIntervalDays(topic.accuracy);
      if (intervalDays === 0) continue;
      const nextRevision = new Date(topic.lastStudiedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
      spacedTopics.push({
        topicId: topic.topicId,
        topicName: topic.topicName,
        chapterName: topic.chapterName,
        subjectName: topic.subjectName,
        accuracy: topic.accuracy,
        attemptCount: topic.attemptCount,
        lastStudiedAt: topic.lastStudiedAt.toISOString(),
        nextRevisionDate: nextRevision.toISOString(),
        isOverdue: nextRevision < now,
        intervalDays,
      });
    }

    return spacedTopics;
  }

  async completeRevisionSession(user: any, dto: { topicId: string; accuracy: number; correctCount?: number; totalQuestions?: number }) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const accuracy = Math.max(0, Math.min(100, Math.round(Number(dto.accuracy ?? 0))));
    const now = new Date();

    const topicRows = await this.ds.query(`SELECT id FROM topics WHERE id = $1`, [dto.topicId]);
    if (!topicRows.length) throw new NotFoundException('Topic not found');

    const progressRows = await this.ds.query(
      `SELECT * FROM school_topic_progress WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, dto.topicId]
    );
    const progress = progressRows[0] || null;
    const status = accuracy >= 70 ? 'completed' : 'in_progress';

    if (!progress) {
      await this.ds.query(
        `INSERT INTO school_topic_progress
          (student_id, topic_id, status, best_accuracy, completed_at, revision_accuracy, last_revised_at, revision_attempt_count, unlocked_at)
         VALUES ($1, $2, $3, $4, $5, $4, $5, 1, $5)`,
        [student.student_id, dto.topicId, status, accuracy, now]
      );
    } else {
      await this.ds.query(
        `UPDATE school_topic_progress
         SET status = $1,
             best_accuracy = GREATEST(COALESCE(best_accuracy, 0), $2),
             completed_at = COALESCE(completed_at, $3),
             revision_accuracy = $2,
             last_revised_at = $3,
             revision_attempt_count = COALESCE(revision_attempt_count, 0) + 1,
             unlocked_at = COALESCE(unlocked_at, $3)
         WHERE id = $4`,
        [status, accuracy, now, progress.id]
      );
    }

    const intervalDays = this.revisionIntervalDays(accuracy);
    const nextRevisionDate = intervalDays > 0
      ? new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    return {
      success: true,
      accuracy,
      intervalDays,
      nextRevisionDate,
      cleared: intervalDays === 0,
    };
  }

  async getRevisionIntensive(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const planRows = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );

    const subjectRows = await this.ds.query(
      `SELECT DISTINCT sub.id, sub.name
       FROM subjects sub
       WHERE sub.class_id::text = $1::text
         AND (sub.section_id IS NULL OR sub.section_id::text = $2::text)
       UNION
       SELECT DISTINCT scoped.id, scoped.name
       FROM teacher_academic_assignments taa
       JOIN subjects assigned_sub ON assigned_sub.id::text = taa.subject_id::text
       JOIN subjects scoped
         ON LOWER(TRIM(scoped.name)) = LOWER(TRIM(assigned_sub.name))
        AND scoped.class_id::text = $1::text
        AND (scoped.section_id IS NULL OR scoped.section_id::text = $2::text)
       WHERE taa.class_id::text = $1::text
         AND taa.section_id::text = $2::text
       ORDER BY name`,
      [targetClassId, student.section_id]
    );

    const subjectIds = subjectRows.map(s => s.id);
    if (!subjectIds.length) {
      return { subjects: [], summary: { completedTopics: 0, totalTopics: 0 } };
    }

    // Fetch student results for topic accuracies
    const topicResults = await this.ds.query(
      `SELECT a.topic_id,
              AVG(CASE WHEN r.percentage IS NOT NULL THEN r.percentage
                       WHEN r.total_marks > 0 THEN (r.marks_obtained::numeric / r.total_marks) * 100
                       ELSE 0 END) AS avg_pct,
              MAX(r.updated_at) AS latest_date
       FROM results r
       JOIN assessments a ON a.id = r.assessment_id
       WHERE r.student_id = $1 AND a.topic_id IS NOT NULL
       GROUP BY a.topic_id`,
      [student.user_id]
    );
    const topicAccuracyMap = new Map<string, number>(
      topicResults.map((r: any) => [String(r.topic_id), Math.round(Number(r.avg_pct))])
    );
    const topicLatestDateMap = new Map<string, string>(
      topicResults.map((r: any) => [String(r.topic_id), r.latest_date])
    );

    // Fetch student results for chapter accuracies
    const chapterResults = await this.ds.query(
      `SELECT a.chapter_id,
              AVG(CASE WHEN r.percentage IS NOT NULL THEN r.percentage
                       WHEN r.total_marks > 0 THEN (r.marks_obtained::numeric / r.total_marks) * 100
                       ELSE 0 END) AS avg_pct
       FROM results r
       JOIN assessments a ON a.id = r.assessment_id
       WHERE r.student_id = $1 AND a.chapter_id IS NOT NULL
       GROUP BY a.chapter_id`,
      [student.user_id]
    );
    const chapterAccuracyMap = new Map<string, number>(
      chapterResults.map((r: any) => [String(r.chapter_id), Math.round(Number(r.avg_pct))])
    );

    let completedTopicIds = new Set<string>();
    if (planRows.length) {
      const planId = planRows[0].id;
      const completed = await this.ds.query(
        `SELECT content_json FROM school_plan_items WHERE study_plan_id = $1 AND status = 'completed'`,
        [planId]
      );
      for (const row of completed) {
        const content = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
        if (content?.topicId) completedTopicIds.add(content.topicId);
      }
    }

    const subjects = [];
    for (const sub of subjectRows) {
      const chapterRows = await this.ds.query(
        `SELECT id, name FROM chapters WHERE subject_id = $1 ORDER BY sort_order, name`,
        [sub.id]
      );

      const chapters = [];
      for (const chap of chapterRows) {
        const topicRows = await this.ds.query(
          `SELECT id, name FROM topics WHERE chapter_id = $1 ORDER BY sort_order, name`,
          [chap.id]
        );

        const topics = topicRows.map((top: any) => {
          const isCompleted = completedTopicIds.has(top.id);
          const hasResult = topicAccuracyMap.has(String(top.id));
          const accuracy = hasResult ? topicAccuracyMap.get(String(top.id)) : (isCompleted ? 75 : 0);
          const latestDate = hasResult ? topicLatestDateMap.get(String(top.id)) : null;

          // Topic is completed if completed in plan, or if accuracy >= 50% from assessment results
          const status = (isCompleted || (hasResult && accuracy >= 50)) ? 'completed' : (hasResult ? 'in_progress' : 'unlocked');

          // Simulate pyq block for low-accuracy topics so they show up under High Negative-Marking Areas
          const pyq = (hasResult && accuracy < 50) ? {
            attempted: 5,
            correct: Math.round(5 * (accuracy / 100)),
            accuracy: accuracy,
          } : null;

          return {
            topicId: top.id,
            topicName: top.name,
            bestAccuracy: accuracy,
            status,
            completedAt: latestDate || (isCompleted ? new Date().toISOString() : null),
            attemptCount: hasResult ? 3 : (isCompleted ? 1 : 0),
            pyq,
            aiSession: null,
          };
        });

        const overallAccuracy = chapterAccuracyMap.has(String(chap.id))
          ? chapterAccuracyMap.get(String(chap.id))
          : (topics.length ? Math.round(topics.reduce((sum: number, t: any) => sum + t.bestAccuracy, 0) / topics.length) : 0);

        chapters.push({
          chapterId: chap.id,
          chapterName: chap.name,
          topicsCompleted: topics.filter((t: any) => t.status === 'completed').length,
          topicsTotal: topics.length,
          overallAccuracy,
          topics
        });
      }

      subjects.push({
        subjectId: sub.id,
        subjectName: sub.name,
        topicsTotal: chapters.reduce((sum, c) => sum + c.topicsTotal, 0),
        topicsCompleted: chapters.reduce((sum, c) => sum + c.topicsCompleted, 0),
        chapters
      });
    }

    return {
      subjects,
      summary: {
        completedTopics: subjects.reduce((sum, s) => sum + s.topicsCompleted, 0),
        totalTopics: subjects.reduce((sum, s) => sum + s.topicsTotal, 0)
      }
    };
  }


  async getRevisionNotes(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);

    // Get AI study sessions completed by the student
    const rows = await this.ds.query(
      `SELECT s.*, t.name AS topic_name, chap.name AS chapter_name, sub.name AS subject_name
       FROM school_ai_study_sessions s
       JOIN topics t ON s.topic_id = t.id
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE s.student_id = $1 AND s.is_completed = true
       ORDER BY s.completed_at DESC`,
      [student.student_id]
    );

    return rows.map((session: any) => ({
      id: session.id,
      topicId: session.topic_id,
      topicName: session.topic_name,
      chapterName: session.chapter_name,
      subjectName: session.subject_name,
      completedAt: session.completed_at,
      isCompleted: true,
      timeSpentSeconds: session.time_spent_seconds ?? 0,
      keyConcepts: session.key_concepts ?? [],
      formulas: session.formulas ?? [],
      highlights: session.highlights ?? [],
      inlineComments: session.inline_comments ?? [],
      conversation: session.conversation ?? [],
      lessonMarkdown: session.lesson_markdown ?? '',
      practiceQuestions: [],
      commonMistakes: [],
      notesTitle: `AI Summary Notes - ${session.topic_name}`,
      notesUrl: '#'
    }));
  }

  async getRevisionPractice(user: any, classId?: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const targetClassId = classId || student.class_id;

    const planRows = await this.ds.query(
      `SELECT id FROM school_study_plans WHERE student_id = $1 AND class_id = $2`,
      [student.student_id, targetClassId]
    );
    if (!planRows.length) return [];
    const planId = planRows[0].id;

    const items = await this.ds.query(
      `SELECT id, scheduled_date AS date, type, title, duration_minutes AS "durationMinutes", xp_reward AS "xpReward", status, subject_name AS "subjectName", content_json AS content, completed_at AS "completedAt"
       FROM school_plan_items
       WHERE study_plan_id = $1 AND status = 'completed' AND type = 'practice'
       ORDER BY completed_at DESC`,
      [planId]
    );

    const topicIds: string[] = [];
    const resolvedItems = items.map((i: any) => {
      const content = typeof i.content === 'string' ? JSON.parse(i.content) : i.content;
      const tId = content?.topicId;
      if (tId && !topicIds.includes(tId)) {
        topicIds.push(tId);
      }
      return { ...i, topicId: tId, content };
    });

    if (topicIds.length === 0) return [];

    const sessionRows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE student_id = $1 AND topic_id = ANY($2)`,
      [student.student_id, topicIds]
    );
    const sessionMap = new Map<string, any>(sessionRows.map((s: any) => [s.topic_id, s]));

    return resolvedItems.map((i: any) => {
      const session = sessionMap.get(i.topicId);
      return {
        id: `practice-${i.topicId}`,
        topicId: i.topicId,
        topicName: i.content?.topicName ?? '',
        chapterName: i.content?.chapterName ?? '',
        subjectName: i.content?.subjectName ?? '',
        completedAt: i.completedAt,
        isCompleted: true,
        timeSpentSeconds: session?.time_spent_seconds ?? 0,
        practiceQuestions: session?.practice_questions ?? [],
        lessonMarkdown: '',
        keyConcepts: [],
        formulas: [],
        commonMistakes: [],
        highlights: [],
        conversation: [],
        accuracy: 80,
        score: 8,
        totalQuestions: 10
      };
    });
  }

  async startRevisionSession(user: any, topicId: string, accuracy: number, intervalDays: number) {
    await this.ensureTables();
    const topicRows = await this.ds.query(
      `SELECT t.id, t.name AS topic_name, chap.name AS chapter_name, sub.name AS subject_name
       FROM topics t
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE t.id = $1`,
      [topicId]
    );
    if (!topicRows.length) throw new NotFoundException('Topic not found');
    const topic = topicRows[0];

    const sessionType = intervalDays === 1 ? 'INTENSIVE' : intervalDays === 3 ? 'STANDARD' : intervalDays === 7 ? 'QUICK' : 'FLASH';
    const estimatedMinutes = intervalDays === 1 ? 20 : intervalDays === 3 ? 15 : intervalDays === 7 ? 10 : 5;
    const targetAccuracy = Math.min(accuracy + 15, 85);
    const drillCount = sessionType === 'INTENSIVE' ? 10 : sessionType === 'STANDARD' ? 7 : sessionType === 'QUICK' ? 5 : 3;
    const baseDifficulty = accuracy < 40 ? 'easy' : accuracy < 65 ? 'medium' : 'hard';

    let drillQuestions = [];
    try {
      const generated = await this.aiBridgeService.generateQuestionsFromTopic(
        { topicId, topicName: topic.topic_name, count: drillCount, difficulty: baseDifficulty, type: 'mcq_single', subject: topic.subject_name, chapter: topic.chapter_name },
        user.instituteId,
      );
      if (Array.isArray(generated)) {
        drillQuestions = generated.map(q => {
          const rawOpts: any[] = q.options ?? q.choices ?? [];
          const options = rawOpts.map((o: any) => typeof o === 'string' ? o : (o.content ?? o.text ?? o.value ?? String(o)));
          return {
            question: q.question ?? q.questionText ?? '',
            options,
            correctAnswer: q.answer ?? q.correctAnswer ?? '',
            explanation: q.explanation ?? '',
            difficulty: q.difficulty ?? baseDifficulty
          };
        });
      }
    } catch (e) {
      this.logger.warn(`[RevisionSession] Question generation failed: ${(e as Error).message}`);
    }

    if (drillQuestions.length === 0) {
      drillQuestions = Array.from({ length: drillCount }).map((_, i) => ({
        question: `Sample Practice Question ${i + 1} about ${topic.topic_name}. Which option is correct?`,
        options: ['Option A (Correct)', 'Option B', 'Option C', 'Option D'],
        correctAnswer: 'Option A (Correct)',
        explanation: `This is a sample explanation for practice question ${i + 1}.`,
        difficulty: baseDifficulty
      }));
    }

    const conceptQuestions = [
      { question: `What is the key core concept of ${topic.topic_name}?`, answer: `This is the main definition and framework for understanding ${topic.topic_name}.`, explanation: '' },
      { question: `What is a common application of ${topic.topic_name}?`, answer: `We apply this in solving related academic problems.`, explanation: '' }
    ];

    const recallPrompts = [
      `What are the 3 most important points in ${topic.topic_name}?`,
      `Write down 1 formula or definition you remember from ${topic.topic_name}.`,
      `What part of ${topic.topic_name} did you find most challenging?`
    ];

    return {
      sessionType,
      estimatedMinutes,
      targetAccuracy,
      previousAccuracy: accuracy,
      topicName: topic.topic_name,
      subjectName: topic.subject_name,
      chapterName: topic.chapter_name,
      recallPrompts,
      conceptQuestions,
      drillQuestions
    };
  }

  async getStudyStatus(user: any, topicId: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const topicRows = await this.ds.query(
      `SELECT t.id, t.name FROM topics t WHERE t.id = $1`,
      [topicId]
    );
    if (!topicRows.length) throw new NotFoundException('Topic not found');
    const topic = topicRows[0];

    const sessionRows = await this.ds.query(
      `SELECT id, is_completed FROM school_ai_study_sessions WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, topicId]
    );
    const aiSession = sessionRows[0] || null;

    return {
      topicId,
      topicName: topic.name,
      hasTeacherLecture: false,
      lectureCount: 0,
      hasAiSession: !!aiSession,
      aiSessionId: aiSession?.id ?? null,
      isAiSessionCompleted: aiSession?.is_completed ?? false,
      gatePassPercentage: 70,
      estimatedStudyMinutes: 30,
    };
  }

  async startAiStudy(user: any, topicId: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const topicRows = await this.ds.query(
      `SELECT t.id AS topic_id, t.name AS topic_name, chap.name AS chapter_name, sub.name AS subject_name
       FROM topics t
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE t.id = $1`,
      [topicId]
    );
    if (!topicRows.length) throw new NotFoundException(`Topic ${topicId} not found`);
    const topic = topicRows[0];

    const existingRows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, topicId]
    );
    const existing = existingRows[0] || null;

    const tenantId = user.instituteId || user.schoolId || 'school';

    if (existing && !this.shouldRegenerateLesson(existing.lesson_markdown, topic.subject_name)) {
      let practiceQuestions = existing.practice_questions;
      if (!practiceQuestions || practiceQuestions.length === 0 || !this.hasStructuredPracticeOptions(practiceQuestions)) {
        try {
          const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
            {
              topicId,
              topicName: topic.topic_name,
              count: 8,
              difficulty: 'easy_medium',
              type: 'mcq_single',
              subject: topic.subject_name || undefined,
              chapter: topic.chapter_name || undefined,
            },
            tenantId,
          ) as any[];
          if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
            practiceQuestions = rawQuestions
              .map((q: any) => this.mapRawPracticeQuestion(q))
              .filter((q: any) => q.question);
            await this.ds.query(
              `UPDATE school_ai_study_sessions SET practice_questions = $1 WHERE id = $2`,
              [JSON.stringify(practiceQuestions), existing.id]
            );
          }
        } catch (err) {
          this.logger.warn(`Backfill practice questions failed for school session ${existing.id}: ${err.message}`);
        }
      }
      return {
        id: existing.id,
        topicId,
        topicName: topic.topic_name,
        lessonMarkdown: this.normalizeSolvedExamplesFormatting(existing.lesson_markdown),
        keyConcepts: existing.key_concepts || [],
        formulas: existing.formulas || [],
        practiceQuestions: practiceQuestions || [],
        commonMistakes: existing.common_mistakes || [],
        conversation: existing.conversation || [],
        isCompleted: existing.is_completed || false,
        timeSpentSeconds: existing.time_spent_seconds || 0,
        completedAt: existing.completed_at ?? null,
        highlights: existing.highlights ?? [],
        inlineComments: existing.inline_comments ?? [],
        isNew: false,
      };
    }

    const studentClass = student.class_name || '10';
    const targetLabel = `School Curriculum - Class ${studentClass}`;
    const tierCalibration = `- Clear, accessible explanations suitable for the student's class (Class ${studentClass})
- NCERT-aligned content with simple worked examples
- Focus on concept understanding over calculation complexity`;

    const selfStudyPrompt = this.buildSubjectPrompt(topic, studentClass, targetLabel, tierCalibration);

    let lessonMarkdown = '';
    let aiSessionRef: string | null = null;
    let keyConcepts: string[] = [];
    let formulas: string[] = [];
    let commonMistakes: string[] = [];
    let practiceQuestions: any[] = [];

    try {
      const lessonResponse = await this.aiBridgeService.startTutorSession(
        { studentId: student.student_id, topicId, context: selfStudyPrompt },
        tenantId,
      ) as any;

      lessonMarkdown = this.normalizeSolvedExamplesFormatting(this.extractAiText(lessonResponse));
      aiSessionRef = this.extractAiSessionRef(lessonResponse);
      keyConcepts = this.extractBulletSection(lessonMarkdown, 'Core Concepts');
      formulas = this.extractBulletSection(lessonMarkdown, 'Key Formulas');
      if (!formulas.length) {
        formulas = this.extractFormulaCandidates(lessonMarkdown);
      }
      commonMistakes = this.extractBulletSection(lessonMarkdown, 'Common Mistakes Students Make');
    } catch (err) {
      this.logger.warn(`AI lesson generation failed for topic ${topicId}: ${err.message}`);
      if (existing && !this.shouldRegenerateLesson(existing.lesson_markdown, topic.subject_name)) {
        lessonMarkdown = this.normalizeSolvedExamplesFormatting(existing.lesson_markdown);
        keyConcepts = existing.key_concepts ?? [];
        formulas = existing.formulas ?? [];
        commonMistakes = existing.common_mistakes ?? [];
        aiSessionRef = existing.ai_session_ref ?? null;
      } else {
        return {
          id: existing?.id ?? null,
          topicId,
          topicName: topic.topic_name,
          lessonMarkdown: 'AI lesson generation is temporarily unavailable. Please try again in a moment.',
          keyConcepts: [],
          formulas: [],
          practiceQuestions: [],
          commonMistakes: [],
          conversation: [],
          isCompleted: false,
          timeSpentSeconds: 0,
          completedAt: null,
          isNew: false,
        };
      }
    }

    try {
      const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
        {
          topicId,
          topicName: topic.topic_name,
          count: 8,
          difficulty: 'easy_medium',
          type: 'mcq_single',
          subject: topic.subject_name || undefined,
          chapter: topic.chapter_name || undefined,
        },
        tenantId,
      ) as any[];

      if (Array.isArray(rawQuestions)) {
        practiceQuestions = rawQuestions
          .map((q: any) => this.mapRawPracticeQuestion(q))
          .filter((q: any) => q.question);
      }
    } catch (err) {
      this.logger.warn(`Practice question generation failed for topic ${topicId}: ${err.message}`);
    }

    const introMessage = lessonMarkdown.split('\n').find((l) => l.trim() && !l.startsWith('#'))
      ?? `Here is your AI-generated lesson on ${topic.topic_name}.`;

    const initialConversation = [{ role: 'ai', message: introMessage, timestamp: new Date().toISOString() }];

    let savedSession;
    if (existing) {
      const res = await this.ds.query(
        `UPDATE school_ai_study_sessions
         SET lesson_markdown = $1, key_concepts = $2, formulas = $3, practice_questions = $4, common_mistakes = $5, ai_session_ref = $6, conversation = $7, is_completed = false, completed_at = null, time_spent_seconds = 0
         WHERE id = $8 RETURNING *`,
        [
          lessonMarkdown,
          JSON.stringify(keyConcepts),
          JSON.stringify(formulas),
          JSON.stringify(practiceQuestions),
          JSON.stringify(commonMistakes),
          aiSessionRef,
          JSON.stringify(initialConversation),
          existing.id
        ]
      );
      savedSession = res[0];
    } else {
      const res = await this.ds.query(
        `INSERT INTO school_ai_study_sessions (student_id, topic_id, lesson_markdown, key_concepts, formulas, practice_questions, common_mistakes, ai_session_ref, conversation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          student.student_id,
          topicId,
          lessonMarkdown,
          JSON.stringify(keyConcepts),
          JSON.stringify(formulas),
          JSON.stringify(practiceQuestions),
          JSON.stringify(commonMistakes),
          aiSessionRef,
          JSON.stringify(initialConversation)
        ]
      );
      savedSession = res[0];
    }

    return {
      id: savedSession.id,
      topicId,
      topicName: topic.topic_name,
      lessonMarkdown: this.normalizeSolvedExamplesFormatting(savedSession.lesson_markdown),
      keyConcepts: savedSession.key_concepts || [],
      formulas: savedSession.formulas || [],
      practiceQuestions: savedSession.practice_questions || [],
      commonMistakes: savedSession.common_mistakes || [],
      conversation: savedSession.conversation || [],
      isCompleted: savedSession.is_completed || false,
      timeSpentSeconds: savedSession.time_spent_seconds || 0,
      completedAt: savedSession.completed_at ?? null,
      highlights: savedSession.highlights ?? [],
      inlineComments: savedSession.inline_comments ?? [],
      isNew: true,
    };
  }

  async getAiStudySession(user: any, topicId: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const sessionRows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, topicId]
    );
    const session = sessionRows[0] || null;
    if (!session) return null;

    const tenantId = user.instituteId || user.schoolId || 'school';
    const topicSubjectRows = await this.ds.query(
      `SELECT sub.name AS subject_name FROM topics t JOIN chapters chap ON t.chapter_id = chap.id JOIN subjects sub ON chap.subject_id = sub.id WHERE t.id = $1`,
      [topicId]
    );
    const sessionSubjectName = topicSubjectRows[0]?.subject_name ?? '';
    if (this.shouldRegenerateLesson(session.lesson_markdown, sessionSubjectName)) {
      try {
        return await this.startAiStudy(user, topicId);
      } catch (err) {
        this.logger.warn(`Auto-regeneration failed for school session ${session.id}: ${err.message}`);
      }
    }

    let practiceQuestions = session.practice_questions || [];
    if (!practiceQuestions || practiceQuestions.length === 0 || !this.hasStructuredPracticeOptions(practiceQuestions)) {
      try {
        const topicRows = await this.ds.query(`SELECT name FROM topics WHERE id = $1`, [topicId]);
        if (topicRows.length) {
          const rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
            {
              topicId,
              topicName: topicRows[0].name,
              count: 8,
              difficulty: 'easy_medium',
              type: 'mcq_single',
            },
            tenantId,
          ) as any[];
          if (Array.isArray(rawQuestions) && rawQuestions.length > 0) {
            practiceQuestions = rawQuestions
              .map((q: any) => this.mapRawPracticeQuestion(q))
              .filter((q: any) => q.question);
            await this.ds.query(
              `UPDATE school_ai_study_sessions SET practice_questions = $1 WHERE id = $2`,
              [JSON.stringify(practiceQuestions), session.id]
            );
          }
        }
      } catch (err) {
        this.logger.warn(`Backfill practice questions failed for school session ${session.id}: ${err.message}`);
      }
    }

    let formulas = session.formulas || [];
    if ((!formulas || formulas.length === 0) && session.lesson_markdown) {
      const extracted =
        this.extractBulletSection(session.lesson_markdown, 'Key Formulas').length
          ? this.extractBulletSection(session.lesson_markdown, 'Key Formulas')
          : this.extractFormulaCandidates(session.lesson_markdown);
      if (extracted.length) {
        formulas = extracted;
        await this.ds.query(
          `UPDATE school_ai_study_sessions SET formulas = $1 WHERE id = $2`,
          [JSON.stringify(formulas), session.id]
        );
      }
    }

    return {
      id: session.id,
      topicId,
      lessonMarkdown: this.normalizeSolvedExamplesFormatting(session.lesson_markdown),
      keyConcepts: session.key_concepts || [],
      formulas: formulas || [],
      practiceQuestions: practiceQuestions || [],
      commonMistakes: session.common_mistakes || [],
      conversation: session.conversation || [],
      isCompleted: session.is_completed || false,
      timeSpentSeconds: session.time_spent_seconds || 0,
      completedAt: session.completed_at ?? null,
      highlights: session.highlights ?? [],
      inlineComments: session.inline_comments ?? [],
    };
  }

  async askAiQuestion(user: any, topicId: string, sessionId: string, question: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const sessionRows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE id = $1 AND student_id = $2 AND topic_id = $3`,
      [sessionId, student.student_id, topicId]
    );
    const session = sessionRows[0] || null;
    if (!session) throw new NotFoundException('AI study session not found');

    const tenantId = user.instituteId || user.schoolId || 'school';
    let aiResponse = '';
    try {
      const lessonContext = this.buildLessonContextForPrompt(session.lesson_markdown);
      const contextualQuestion = lessonContext
        ? `Topic: ${topicId}\nUse the existing lesson context below to answer precisely.\n${lessonContext}\n\nStudent question: ${question}`
        : question;
      const response = await this.aiBridgeService.continueTutorSession(
        { sessionId: session.ai_session_ref ?? sessionId, studentMessage: contextualQuestion },
        tenantId,
      ) as any;
      aiResponse = this.extractAiText(response);
    } catch (err) {
      this.logger.warn(`AI follow-up failed for school session ${sessionId}: ${err.message}`);
      aiResponse = 'I could not process your question right now. Please try again.';
    }

    const now = new Date().toISOString();
    const newMessages = [
      { role: 'student' as const, message: question, timestamp: now },
      { role: 'ai' as const, message: aiResponse, timestamp: now },
    ];

    const conversation = session.conversation || [];
    const firstMessage = conversation[0];
    let updated = [...conversation, ...newMessages];
    if (updated.length > 50) {
      updated = [firstMessage, ...updated.slice(-49)];
    }

    await this.ds.query(
      `UPDATE school_ai_study_sessions SET conversation = $1 WHERE id = $2`,
      [JSON.stringify(updated), session.id]
    );

    return {
      sessionId: session.id,
      studentQuestion: question,
      aiResponse,
      timestamp: now,
      conversation: updated,
    };
  }

  async completeAiStudy(user: any, topicId: string, sessionId: string, dto: any) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const sessionRows = await this.ds.query(
      `SELECT * FROM school_ai_study_sessions WHERE id = $1 AND student_id = $2 AND topic_id = $3`,
      [sessionId, student.student_id, topicId]
    );
    const session = sessionRows[0] || null;
    if (!session) throw new NotFoundException('AI study session not found');

    const now = new Date();
    await this.ds.query(
      `UPDATE school_ai_study_sessions
       SET is_completed = true, completed_at = $1, time_spent_seconds = $2, highlights = $3, inline_comments = $4
       WHERE id = $5`,
      [now, dto.timeSpentSeconds, JSON.stringify(dto.highlights), JSON.stringify(dto.inlineComments), session.id]
    );

    let progressRows = await this.ds.query(
      `SELECT * FROM school_topic_progress WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, topicId]
    );
    let progress = progressRows[0] || null;

    if (!progress) {
      await this.ds.query(
        `INSERT INTO school_topic_progress (student_id, topic_id, status, studied_with_ai, unlocked_at)
         VALUES ($1, $2, 'unlocked', true, $3)`,
         [student.student_id, topicId, now]
      );
    } else {
      await this.ds.query(
        `UPDATE school_topic_progress
         SET studied_with_ai = true, status = CASE WHEN status = 'locked' THEN 'unlocked' ELSE status END, unlocked_at = COALESCE(unlocked_at, $1)
         WHERE id = $2`,
        [now, progress.id]
      );
    }

    const XP_AWARD = 10;
    await this.ds.query(
      `UPDATE students SET xp_total = COALESCE(xp_total, 0) + $1 WHERE id = $2`,
      [XP_AWARD, student.student_id]
    );

    const updatedStudentRows = await this.ds.query(
      `SELECT xp_total FROM students WHERE id = $1`,
      [student.student_id]
    );
    const updatedStudent = updatedStudentRows[0];

    // Auto-complete plan items of type 'lecture' or 'revision' for this topic
    await this.completeItemByTopicAndType(student.student_id, topicId, 'lecture').catch(() => {});
    await this.completeItemByTopicAndType(student.student_id, topicId, 'revision').catch(() => {});

    const topicRows = await this.ds.query(`SELECT name FROM topics WHERE id = $1`, [topicId]);

    return {
      sessionId: session.id,
      isCompleted: true,
      xpAwarded: XP_AWARD,
      xpEarned: XP_AWARD,
      totalXp: updatedStudent?.xp_total ?? 0,
      quizAvailable: true,
      mockTestId: null,
      message: `Great work! You've studied ${topicRows[0]?.name ?? 'the topic'}. Ready to test yourself?`,
    };
  }

  async saveAiStudyNotes(user: any, topicId: string, sessionId: string, dto: any) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    await this.ds.query(
      `UPDATE school_ai_study_sessions SET highlights = $1, inline_comments = $2 WHERE id = $3 AND student_id = $4 AND topic_id = $5`,
      [JSON.stringify(dto.highlights), JSON.stringify(dto.inlineComments), sessionId, student.student_id, topicId]
    );
    return { success: true };
  }

  async getAiStudyHistory(user: any) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const rows = await this.ds.query(
      `SELECT s.*, t.name AS topic_name, sub.name AS subject_name
       FROM school_ai_study_sessions s
       JOIN topics t ON s.topic_id = t.id
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE s.student_id = $1
       ORDER BY s.created_at DESC`,
      [student.student_id]
    );

    return rows.map((session: any) => ({
      id: session.id,
      topicId: session.topic_id,
      topicName: session.topic_name,
      subjectName: session.subject_name,
      lessonMarkdown: this.normalizeSolvedExamplesFormatting(session.lesson_markdown),
      keyConcepts: session.key_concepts || [],
      formulas: session.formulas || [],
      practiceQuestions: session.practice_questions || [],
      conversation: session.conversation || [],
      isCompleted: session.is_completed,
      timeSpentSeconds: session.time_spent_seconds,
      createdAt: session.created_at,
      completedAt: session.completed_at,
    }));
  }

  async generateAiQuiz(user: any, topicId: string) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);
    const tenantId = user.instituteId || user.schoolId || 'school';

    const topicRows = await this.ds.query(
      `SELECT t.id, t.name, chap.name AS chapter_name, sub.name AS subject_name
       FROM topics t
       JOIN chapters chap ON t.chapter_id = chap.id
       JOIN subjects sub ON chap.subject_id = sub.id
       WHERE t.id = $1`,
      [topicId]
    );
    if (!topicRows.length) throw new NotFoundException(`Topic ${topicId} not found`);
    const topic = topicRows[0];

    let rawQuestions: any[] = [];
    try {
      rawQuestions = await this.aiBridgeService.generateQuestionsFromTopic(
        {
          topicId,
          topicName: topic.name,
          count: 8,
          difficulty: 'easy_medium',
          type: 'mcq_single',
          subject: topic.subject_name || undefined,
          chapter: topic.chapter_name || undefined,
        },
        tenantId,
      ) as any[];
    } catch (err) {
      this.logger.warn(`AI quiz generation failed for school topic ${topicId}: ${err.message}`);
      throw new BadRequestException('AI quiz generation is temporarily unavailable. Please try again.');
    }

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      throw new BadRequestException('AI could not generate questions. Please try again.');
    }

    const difficulties = ['easy', 'easy', 'medium', 'medium', 'hard'];
    const formatted = rawQuestions.slice(0, 10).map((q: any, qi: number) => ({
      id: `ai-${topicId.slice(0, 8)}-${qi}`,
      content: q.content ?? q.question ?? '',
      type: 'mcq_single',
      difficulty: q.difficulty ?? difficulties[qi] ?? 'medium',
      marksCorrect: 4,
      marksWrong: 1,
      explanation: q.explanation ?? '',
      options: (q.options ?? []).map((opt: any, oi: number) => ({
        id: `ai-${topicId.slice(0, 8)}-${qi}-${oi}`,
        optionLabel: opt.label ?? String.fromCharCode(65 + oi),
        content: opt.content ?? String(opt),
        isCorrect: !!opt.isCorrect,
      })),
    }));

    return {
      topicId,
      topicName: topic.name,
      durationMinutes: 15,
      totalMarks: formatted.length * 4,
      passingMarks: Math.ceil(formatted.length * 4 * 0.7),
      questions: formatted,
    };
  }

  async completeAiQuiz(user: any, topicId: string, dto: any) {
    await this.ensureTables();
    const student = await this.getStudentProfile(user.id);

    const passed = dto.accuracy >= 70;
    const now = new Date();

    const progressRows = await this.ds.query(
      `SELECT * FROM school_topic_progress WHERE student_id = $1 AND topic_id = $2`,
      [student.student_id, topicId]
    );
    const progress = progressRows[0] || null;

    if (!progress) {
      await this.ds.query(
        `INSERT INTO school_topic_progress (student_id, topic_id, status, best_accuracy, completed_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [student.student_id, topicId, passed ? 'completed' : 'in_progress', dto.accuracy, passed ? now : null]
      );
    } else {
      let newStatus = progress.status;
      if (passed) {
        newStatus = 'completed';
      } else if (progress.status === 'locked' || progress.status === 'unlocked') {
        newStatus = 'in_progress';
      }
      const bestAccuracy = Math.max(progress.best_accuracy || 0, dto.accuracy);
      await this.ds.query(
        `UPDATE school_topic_progress
         SET status = $1, best_accuracy = $2, completed_at = COALESCE(completed_at, $3)
         WHERE id = $4`,
        [newStatus, bestAccuracy, passed ? now : null, progress.id]
      );
    }

    const xpEarned = passed ? 15 : 8;
    await this.ds.query(
      `UPDATE students SET xp_total = COALESCE(xp_total, 0) + $1 WHERE id = $2`,
      [xpEarned, student.student_id]
    );

    // Auto-complete planner item of type 'practice' for this topic
    await this.completeItemByTopicAndType(student.student_id, topicId, 'practice').catch(() => {});

    return {
      passed,
      accuracy: dto.accuracy,
      score: dto.score,
      totalMarks: dto.totalMarks,
      xpEarned,
      message: passed
        ? `Excellent! You passed with ${dto.accuracy.toFixed(0)}% accuracy. Next topic unlocked!`
        : `You scored ${dto.accuracy.toFixed(0)}%. Need 70%+ to pass. Keep practising!`,
    };
  }

  async completeItemByTopicAndType(studentId: string, topicId: string, type: string) {
    const rows = await this.ds.query(
      `SELECT pi.id, pi.xp_reward 
       FROM school_plan_items pi
       JOIN school_study_plans p ON pi.study_plan_id = p.id
       WHERE p.student_id = $1 AND pi.type = $2 AND pi.status = 'pending' AND pi.content_json->>'topicId' = $3
       ORDER BY pi.scheduled_date ASC, pi.created_at ASC
       LIMIT 1`,
      [studentId, type, topicId]
    );
    if (rows.length) {
      const item = rows[0];
      await this.ds.query(
        `UPDATE school_plan_items SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [item.id]
      );
      await this.ds.query(
        `UPDATE students SET xp_total = COALESCE(xp_total, 0) + $1 WHERE id = $2`,
        [item.xp_reward, studentId]
      );
      return { success: true, xpAwarded: item.xp_reward };
    }
    return { success: false };
  }

  private extractAiText(response: any): string {
    if (!response) return '';
    if (typeof response === 'string') return response;
    const candidate =
      response.response
      ?? response.message
      ?? response.data?.response
      ?? response.data?.message
      ?? response.text
      ?? '';

    const unwrap = (v: any): string => {
      if (!v) return '';
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            return unwrap(JSON.parse(trimmed));
          } catch {
            return v;
          }
        }
        return v;
      }
      if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) {
        return v.map((s) => String(s).trim()).filter(Boolean).join(' ');
      }
      if (typeof v === 'object' && v !== null) {
        const r =
          (typeof v.response === 'string' && v.response.trim() ? v.response : '') ||
          (typeof v.answer === 'string' && v.answer.trim() ? v.answer : '') ||
          (typeof v.message === 'string' && v.message.trim() ? v.message : '');
        if (r) return r;
        if (Array.isArray(v.hints) && v.hints.length) {
          const lines = v.hints.map((h: any) => String(h).trim()).filter(Boolean);
          return lines.join(' ');
        }
        return JSON.stringify(v);
      }
      return String(v);
    };

    return unwrap(candidate);
  }

  private mapRawPracticeQuestion(q: any): { question: string; answer: string; explanation: string; options?: string[] } {
    const rawOptions = Array.isArray(q?.options) ? q.options : [];
    const options = rawOptions
      .map((o: any) => String(o?.content ?? o?.text ?? '').trim())
      .filter((v: string) => Boolean(v));
    const correctOption = rawOptions.find((o: any) => o?.isCorrect);
    const fallbackAnswer = String(q?.answer ?? '').trim();
    return {
      question: String(q?.content ?? q?.question ?? '').trim(),
      answer: String(correctOption?.content ?? fallbackAnswer).trim(),
      explanation: String(q?.explanation ?? '').trim(),
      options: options.length ? options : undefined,
    };
  }

  private hasStructuredPracticeOptions(
    questions: Array<{ question: string; answer: string; explanation: string; options?: string[] }> | null | undefined,
  ): boolean {
    if (!Array.isArray(questions) || questions.length === 0) return false;
    return questions.some((q) => Array.isArray(q?.options) && q.options.length >= 2);
  }

  private extractAiSessionRef(response: any): string | null {
    if (!response || typeof response !== 'object') return null;
    return response.sessionId ?? response.session_id ?? response.id ?? null;
  }

  private normalizeSolvedExamplesFormatting(markdown: string | null | undefined): string {
    const text = String(markdown || '');
    if (!text) return text;
    return text
      .replace(/([^\n])\s*\*\*Solution:\*\*/g, '$1\n\n**Solution:**')
      .replace(/([^\n])\s*\*\*Answer:\*\*/g, '$1\n\n**Answer:**')
      .replace(/([^\n])\s*\*\*Key takeaway:\*\*/gi, '$1\n\n**Key takeaway:**')
      .replace(/([^\n])\s*\*\*Examiner's Trap:\*\*/gi, '$1\n\n**Examiner\'s Trap:**');
  }

  private extractBulletSection(markdown: string, header: string): string[] {
    const regex = new RegExp(`#{2,4}\\s+[^\\n]*${header}[^\\n]*([^#]*)`, 'i');
    const match = markdown.match(regex);
    if (!match) return [];
    return match[1]
      .split('\n')
      .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter((l) => l.length > 3 && !l.startsWith('['));
  }

  private buildLessonContextForPrompt(markdown: string | null | undefined): string {
    if (!markdown) return '';
    const plain = markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.slice(0, 1200);
  }

  // ─── Subject classification ───────────────────────────────────────────────

  private isHumanitiesSubject(subjectName: string): boolean {
    const lower = (subjectName || '').toLowerCase().trim();
    return /history|geography|civics|political science|economics|sst|social studies|social science|english|hindi|sanskrit|urdu|language|literature|moral science|environmental studies/.test(lower);
  }

  private isBiologySubject(subjectName: string): boolean {
    const lower = (subjectName || '').toLowerCase().trim();
    return /\bbiology\b|botany|zoology|life science|bioscience/.test(lower);
  }

  // ─── Subject-aware prompt builder ────────────────────────────────────────

  private buildSubjectPrompt(
    topic: { topic_name: string; chapter_name: string; subject_name: string },
    studentClass: string,
    targetLabel: string,
    tierCalibration: string,
  ): string {
    if (this.isBiologySubject(topic.subject_name)) {
      return this.buildBiologyPrompt(topic, studentClass, targetLabel, tierCalibration);
    }
    return this.isHumanitiesSubject(topic.subject_name)
      ? this.buildHumanitiesPrompt(topic, studentClass, targetLabel, tierCalibration)
      : this.buildSciencePrompt(topic, studentClass, targetLabel, tierCalibration);
  }

  private buildBiologyPrompt(
    topic: { topic_name: string; chapter_name: string; subject_name: string },
    studentClass: string,
    targetLabel: string,
    tierCalibration: string,
  ): string {
    return `You are a master Biology teacher who creates clear, diagram-friendly, exam-focused school notes.

Generate a COMPLETE, THOROUGH self-study Biology lesson calibrated precisely for this student's goal. Do not use a mathematics problem-solving format.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

IMPORTANT BIOLOGY STYLE RULES:
- Do NOT include algebraic derivations, numeric calculation problems, or step-by-step mathematical solutions unless the topic genuinely needs a simple percentage/ratio calculation.
- Do NOT create a "Derivations" section.
- Use biological explanations: structure, function, processes, flow, diagrams, comparisons, examples, diseases/adaptations where relevant.
- Equations are allowed only for real biological processes, such as photosynthesis or respiration. Explain them as biological process equations, not as math derivations.
- Prefer exam-style descriptive answers, labelled diagrams, flowcharts, tables, and cause-effect explanations.

---

Write the lesson using this EXACT structure. Each section must be detailed and specific to ${topic.topic_name}.

# ${topic.topic_name}

## What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters in living systems, and where students see it in real life or examinations.

## Introduction & Biological Background
Give the conceptual foundation. Explain where this topic fits in Biology, what prior ideas it builds on, and the biological intuition behind it. Minimum 150 words.

## Core Concepts (Explained in Depth)
For EACH major biological concept in this topic:
### Concept Name
- Clear definition
- Biological role or importance
- Structure/function relationship, mechanism, or example
- One quick exam tip

Cover ALL major concepts. Do not skip important terms.

## Key Structures / Processes
Use this section for organs, tissues, cells, molecules, pathways, life processes, or cycles.
For each important structure or process:
### Name
- Where it is found
- What it does
- How it works, step by step in biological language
- Why it matters

## Diagrams & Flowcharts to Practice
List labelled diagrams, flowcharts, cycles, or tables students should be able to draw for this topic.
For each one:
- **Diagram/flowchart:** name
- **Must-label parts:** important labels
- **Caption/explanation:** 2-3 lines students can write under it

## Important Terms & Definitions
Create a glossary of the key Biology terms from this topic.
- **Term:** concise exam-ready definition and one example if useful

## Comparisons & Tables
Include useful comparison tables where relevant, such as structure vs function, types, stages, kingdoms, systems, diseases, or processes.
If no comparison is relevant, include a short table of "Concept | Key point | Exam relevance".

## Biological Process Equations *(Only If Relevant)*
Include this section only when the topic has standard biological word equations or balanced equations.
Examples: photosynthesis, aerobic respiration, anaerobic respiration.
For each:
- Word equation
- Balanced equation if applicable
- Biological meaning of each reactant/product
- Conditions or location in the organism/cell
If no biological process equation applies, write: "No process equation is required for this topic."

## Exam-Style Questions & Model Answers
Provide 3 descriptive Biology questions with model answers.

### Example 1 - Basic
[Definition/short answer/diagram-based question]
**Model Answer:**
[Complete answer]
**Key points that earn marks:** ...

### Example 2 - Intermediate
[Process/comparison/function question]
**Model Answer:** ...

### Example 3 - Advanced
[Application, reasoning, diagram, disease, experiment, or HOTS-style question]
**Model Answer:** ...

## Connections to Other Topics
- How this topic links to related Biology chapters
- Any Chemistry/Physics/Environment/Health connections if genuinely relevant

## Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## Exam Strategy
- How this topic typically appears in school exams
- Diagrams, definitions, processes, and comparisons examiners expect
- How to write 2-mark, 3-mark, and 5-mark Biology answers
- Common traps in terminology and diagrams

## Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize.

## Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete Biology content about ${topic.topic_name}.`;
  }

  private buildSciencePrompt(
    topic: { topic_name: string; chapter_name: string; subject_name: string },
    studentClass: string,
    targetLabel: string,
    tierCalibration: string,
  ): string {
    return `You are a master teacher who has helped thousands of students crack school examinations. Your lessons are legendary for being crystal-clear, deeply comprehensive, and exam-focused.

Generate a COMPLETE, THOROUGH self-study lesson calibrated precisely for this student's goal. Do not cut corners — depth and clarity are the priority.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topic.topic_name}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters, and what real-world phenomena it explains. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — where this topic fits in ${topic.subject_name}, what prior knowledge it builds on, and the intuition behind it. Use analogies to make abstract ideas concrete. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept in this topic:
### Concept Name
- Clear definition
- Intuitive explanation with a relatable analogy or real-world example
- A short illustrative example

Cover ALL concepts — do not skip any.

## 📝 Formulas & Equations
INCLUDE THIS SECTION ONLY if this topic has mathematical formulas, physical laws, or chemical equations.
If this is a conceptual/descriptive chapter with no quantitative formulas (e.g. classification, ecology, cell biology, atomic structure theory), write: "No key formulas for this topic — focus is on conceptual understanding."
Otherwise, for EVERY formula or equation:
### Formula / Equation Name
$$formula or balanced chemical equation$$
- Variables / Species: define each symbol or reactant/product
- Units: state SI units (for physics/maths) or conditions (for chemistry)
- When it applies: assumptions or scope

## 📊 Derivations
INCLUDE THIS SECTION ONLY if there are standard step-by-step derivations for this topic (e.g. equations of motion, lens formula, gas laws).
For Biology chapters, use this section to write the word equation AND balanced chemical equation for key biological processes (e.g. photosynthesis, aerobic respiration, anaerobic respiration) with a brief explanation of each step.
If no derivations apply, omit this section entirely.
### Derivation of [Formula / Process Name]
Step-by-step with clear reasoning at each step.

## 💡 Solved Examples
For Maths / Physics / Chemistry: provide 3 numeric problems (Basic → Intermediate → Hard) with full step-by-step solutions.
For Biology / Computer Science: provide 3 exam-style descriptive questions with model answers (e.g. "Explain with a diagram...", "Compare and contrast...", "Trace the path of...").

### Example 1 — Basic
[Full question]
**Solution:**
Step 1: ...
Step 2: ...
**Answer:** ...
**Key takeaway:** ...

### Example 2 — Intermediate
[Full question]
**Solution:** (detailed)

### Example 3 — Advanced
[Tricky exam-style question]
**Solution:** (complete step-by-step)

## 🧠 Connections to Other Topics
- How this topic links to related topics in ${topic.subject_name}
- Topics that depend on understanding this one

## ⚠️ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 Exam Strategy
- How this topic typically appears in examinations
- For formula-heavy topics: which formulas are most tested and common calculation traps
- For conceptual topics: key definitions, diagrams, and comparisons examiners expect
- Marks distribution and time management tips

## 📋 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize.

## ❓ Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topic.topic_name}.`;
  }

  private buildHumanitiesPrompt(
    topic: { topic_name: string; chapter_name: string; subject_name: string },
    studentClass: string,
    targetLabel: string,
    tierCalibration: string,
  ): string {
    return `You are a master teacher who has helped thousands of students excel in school board examinations. Your notes are legendary for being comprehensive, exam-focused, and crystal-clear.

Generate a COMPLETE, THOROUGH self-study lesson for a humanities/theory subject. Do not cut corners — depth and clarity are the priority.

TARGET: ${targetLabel}
CALIBRATION REQUIREMENTS:
${tierCalibration}

Topic: ${topic.topic_name}
Chapter: ${topic.chapter_name}
Subject: ${topic.subject_name}
Class: ${studentClass}

IMPORTANT: This is a humanities/theory subject. Do NOT include any mathematics formulas, algebraic derivations, or numeric calculation problems. Focus entirely on conceptual understanding, historical/geographical/economic analysis, and board-exam answer-writing skills.

---

Write the lesson using this EXACT structure. Each section must be detailed — not a placeholder.

# ${topic.topic_name}

## 🎯 What You'll Learn
A 2-3 sentence motivating introduction: what this topic is, why it matters, and what it helps us understand about the world. Make it engaging.

## 📖 Introduction & Background
Give the conceptual foundation. Explain the "big picture" — the context of this topic in ${topic.subject_name}, what prior knowledge it builds on, and why it is significant. Use real-world connections to make it relatable. Minimum 150 words.

## 🔑 Core Concepts (Explained in Depth)
For EACH major concept, idea, movement, or theme in this topic:
### Concept / Term / Movement Name
- Clear definition or explanation
- Context: when, where, why it occurred or matters
- Real-world example or analogy to make it concrete

Cover ALL concepts — do not skip any.

## 🗓️ Key Events / Timeline
If this topic involves historical events, movements, policies, or chronological developments, list them:
- **[Year / Period]** — Event/development and its significance
(If this is a geography or economics topic with no timeline, replace this section with: "## 🌍 Key Facts & Data Points" listing the most important facts, statistics, or geographic features students must know.)

## 🔗 Cause & Effect / Analysis
For the major events, processes, or policies in this topic:
- **Cause / Factor:** What led to it?
- **Effect / Consequence:** What resulted from it?
- **Long-term Impact:** Why does it still matter today?

## 🌟 Important People / Places / Movements / Terms
For each key figure, place, movement, or term:
- **Name:** Who/what it is
- **Significance:** Why it matters to this topic
- **Exam relevance:** What type of question this typically appears in

## 📖 Exam-Style Questions & Model Answers
### Example 1 — Short Answer (3 marks)
[Typical board-exam question on this topic]
**Model Answer:**
[Well-structured 3-4 sentence answer hitting the key points]
**Key points that earn marks:** ...

### Example 2 — Long Answer (5 marks)
[Typical board-exam question on this topic]
**Model Answer Structure:**
- Introduction: ...
- Point 1 (with explanation): ...
- Point 2 (with explanation): ...
- Point 3 (with explanation): ...
- Conclusion: ...

### Example 3 — Source-Based / Map / Case Study Question *(if applicable)*
[A source-based or application question typical of board exams]
**How to approach and answer it:** ...

## 🧠 Connections to Other Topics
- How this topic links to other chapters in ${topic.subject_name}
- Cross-subject connections (e.g. how history links to economics or geography)

## ⚠️ Common Mistakes Students Make
For each mistake:
- **Mistake:** what students typically get wrong
- **Why it happens:** root cause
- **Correct approach:** how to avoid it

List at least 4-5 genuine mistakes.

## 🏆 Exam Strategy
- Types of questions asked from this topic (MCQ, 1-mark, 3-mark, 5-mark, source-based)
- Key names, dates, terms, and definitions to memorise
- How to structure a board-exam answer for 3-mark and 5-mark questions
- Common traps and what examiners specifically look for

## 📋 Quick Revision Summary
A numbered list of the 8-10 most critical points to memorize for this topic.

## ❓ Self-Check Questions
5 questions the student should be able to answer after reading this lesson:
1. ...
2. ...
3. ...
4. ...
5. ...

---
Write EVERYTHING above in full. Do not use placeholder text like "[explanation here]". Every section must have real, complete content about ${topic.topic_name}.`;
  }

  // ─── Lesson quality check ────────────────────────────────────────────────

  private shouldRegenerateLesson(markdown: string | null | undefined, subjectName?: string): boolean {
    const text = String(markdown || '');
    if (!text.trim()) return true;
    if (text.length < 4500) return true;

    const isHumanities = this.isHumanitiesSubject(subjectName || '');
    const isBiology = this.isBiologySubject(subjectName || '');

    // Humanities: only require core structural sections — no formula checks
    // Science: require solved examples and exam strategy (formulas are now optional per topic)
    const required = isHumanities || isBiology
      ? ['Core Concepts', 'Exam Strategy']
      : ['Core Concepts', 'Solved Examples', 'Exam Strategy'];

    const missingCount = required.filter((k) => !new RegExp(k, 'i').test(text)).length;
    if (missingCount >= 1) return true;

    // Check for obviously incomplete formula lines — science subjects only
    if (!isHumanities && !isBiology) {
      if (/\$[^$\n]{0,25}=\s*(?:\n|$)/m.test(text)) return true;
      if (/Derivation[\s\S]{0,120}:\s*(?:\n|$)/i.test(text)) return true;
    }

    if (/[=:]\s*$/.test(text.trim())) return true;
    return false;
  }

  private extractFormulaCandidates(markdown: string): string[] {
    const lines = String(markdown || '')
      .split('\n')
      .map((l) => l.replace(/^[-•*\d.]+\s*/, '').trim())
      .filter(Boolean);
    const candidates = lines.filter((l) =>
      /[=∑√Δπ]/.test(l) ||
      /\b(sin|cos|tan|log|ln|velocity|acceleration|force|energy|mole|concentration|probability)\b/i.test(l),
    );
    const unique = Array.from(new Set(candidates.map((c) => c.replace(/\s+/g, ' ').trim())));
    return unique.slice(0, 10);
  }
}
