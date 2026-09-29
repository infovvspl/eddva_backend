import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces `syllabus_topic_progress` as the single source of truth for a
 * topic's completion status within a specific syllabus plan, replacing three
 * things that used to disagree with each other: ad hoc mutation of the
 * `syllabus_plans.chapter_allocations` JSON blob, direct writes to
 * `topics.status/progress`, and a `topic_progress` sync that has always
 * silently failed here (that table only exists in the *coaching* database,
 * under a different unique constraint, while this service runs against the
 * *school* database — every insert into it has been swallowed by a
 * `.catch(() => {})`).
 *
 * Also gives `lesson_plans` a real link to the syllabus plan it covers
 * (`syllabus_plan_id`), and adds FK constraints to the `topic_id`/`chapter_id`
 * columns on `lesson_plans` and the `lesson_plan_id` column on
 * `lesson_completions`, none of which have ever been constrained. Without
 * `syllabus_plan_id`, completing a lesson could only guess which plan(s) to
 * update by matching subject+class with no section/term filter — silently
 * touching every plan that happened to share a subject and class.
 */
export class AddSyllabusTopicProgress1790000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS syllabus_topic_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        syllabus_plan_id UUID NOT NULL REFERENCES syllabus_plans(id) ON DELETE CASCADE,
        topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
        chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
        topic_name VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
        planned_periods INT DEFAULT 1,
        actual_periods INT DEFAULT 0,
        progress INT NOT NULL DEFAULT 0,
        remarks TEXT,
        delay_reason TEXT,
        carry_forward_date DATE,
        completed_at TIMESTAMP WITH TIME ZONE,
        updated_by UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT ux_syllabus_topic_progress_plan_topic UNIQUE (syllabus_plan_id, topic_id)
      );
      CREATE INDEX IF NOT EXISTS idx_syllabus_topic_progress_plan ON syllabus_topic_progress(syllabus_plan_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_stp_plan_topicname
        ON syllabus_topic_progress (syllabus_plan_id, LOWER(BTRIM(topic_name)))
        WHERE topic_id IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS syllabus_plan_id UUID;
    `);

    // subjects never got status/progress columns even though topics and chapters did — the
    // pre-existing "UPDATE subjects SET progress = ..." cascade step silently failed on every
    // call (wrapped in .catch(() => {})). Add them so the subject-level derived cache actually
    // persists instead of continuing to be a no-op.
    await queryRunner.query(`
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';
      ALTER TABLE subjects ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0;
    `);

    // Pre-existing lesson_plans.topic_id / chapter_id and lesson_completions.lesson_plan_id
    // have never been constrained. Clean up anything stale before adding FKs, since these
    // columns may hold ids that no longer resolve after years of unconstrained writes.
    const orphanTopics = await queryRunner.query(`
      SELECT count(*)::int AS n FROM lesson_plans lp
      WHERE lp.topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.id = lp.topic_id)
    `);
    if (Number(orphanTopics[0]?.n || 0) > 0) {
      console.warn(`[AddSyllabusTopicProgress] Clearing ${orphanTopics[0].n} lesson_plans.topic_id value(s) with no matching topic.`);
    }
    await queryRunner.query(`
      UPDATE lesson_plans SET topic_id = NULL
      WHERE topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM topics t WHERE t.id = lesson_plans.topic_id)
    `);

    const orphanChapters = await queryRunner.query(`
      SELECT count(*)::int AS n FROM lesson_plans lp
      WHERE lp.chapter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id = lp.chapter_id)
    `);
    if (Number(orphanChapters[0]?.n || 0) > 0) {
      console.warn(`[AddSyllabusTopicProgress] Clearing ${orphanChapters[0].n} lesson_plans.chapter_id value(s) with no matching chapter.`);
    }
    await queryRunner.query(`
      UPDATE lesson_plans SET chapter_id = NULL
      WHERE chapter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id = lesson_plans.chapter_id)
    `);

    // lesson_completions.lesson_plan_id is NOT NULL, so an orphan here can only be removed,
    // not nulled — a completion record for a lesson plan that no longer exists is unrecoverable
    // history either way.
    const orphanCompletions = await queryRunner.query(`
      SELECT count(*)::int AS n FROM lesson_completions lc
      WHERE NOT EXISTS (SELECT 1 FROM lesson_plans lp WHERE lp.id = lc.lesson_plan_id)
    `);
    if (Number(orphanCompletions[0]?.n || 0) > 0) {
      console.warn(`[AddSyllabusTopicProgress] Deleting ${orphanCompletions[0].n} lesson_completions row(s) whose lesson_plan no longer exists.`);
    }
    await queryRunner.query(`
      DELETE FROM lesson_completions lc
      WHERE NOT EXISTS (SELECT 1 FROM lesson_plans lp WHERE lp.id = lc.lesson_plan_id)
    `);

    await queryRunner.query(`
      ALTER TABLE lesson_plans
        ADD CONSTRAINT fk_lesson_plans_syllabus_plan FOREIGN KEY (syllabus_plan_id) REFERENCES syllabus_plans(id) ON DELETE SET NULL;
      ALTER TABLE lesson_plans
        ADD CONSTRAINT fk_lesson_plans_topic FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL;
      ALTER TABLE lesson_plans
        ADD CONSTRAINT fk_lesson_plans_chapter FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL;
      ALTER TABLE lesson_completions
        ADD CONSTRAINT fk_lesson_completions_lesson_plan FOREIGN KEY (lesson_plan_id) REFERENCES lesson_plans(id) ON DELETE CASCADE;
    `);

    // One-time backfill of existing plans' chapter_allocations JSON into the new relational
    // table, so history captured under the old JSON-mutation approach isn't lost. Ad hoc
    // teacher-added topics use a "custom-top-<ts>-<rand>" string id, not a UUID, so the cast
    // is guarded by a UUID-shape check rather than attempted unconditionally.
    await queryRunner.query(`
      INSERT INTO syllabus_topic_progress
        (syllabus_plan_id, topic_id, chapter_id, topic_name, status, planned_periods, actual_periods, progress, remarks, delay_reason, carry_forward_date, completed_at)
      SELECT
        sp.id,
        CASE WHEN (topic->>'topicId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (topic->>'topicId')::uuid ELSE NULL END,
        CASE WHEN (chapter->>'chapterId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (chapter->>'chapterId')::uuid ELSE NULL END,
        COALESCE(topic->>'topicName', topic->>'name'),
        CASE UPPER(COALESCE(NULLIF(topic->>'status', ''), 'planned'))
          WHEN 'COMPLETED' THEN 'COMPLETED'
          WHEN 'COMPLETE' THEN 'COMPLETED'
          WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
          WHEN 'DELAYED' THEN 'DELAYED'
          ELSE 'PLANNED'
        END,
        COALESCE((topic->>'plannedPeriods')::int, (topic->>'periods')::int, 1),
        COALESCE((topic->>'actualPeriods')::int, 0),
        COALESCE((topic->>'progress')::int, 0),
        topic->>'remarks',
        topic->>'delayReason',
        NULLIF(topic->>'carryForwardDate', '')::date,
        NULLIF(topic->>'completedAt', '')::timestamptz
      FROM syllabus_plans sp,
           jsonb_array_elements(sp.chapter_allocations) AS chapter,
           jsonb_array_elements(COALESCE(chapter->'topics', '[]'::jsonb)) AS topic
      WHERE jsonb_typeof(sp.chapter_allocations) = 'array'
        AND jsonb_typeof(COALESCE(chapter->'topics', '[]'::jsonb)) = 'array'
      ON CONFLICT (syllabus_plan_id, topic_id) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The orphan cleanup above (nulled/deleted rows) is not reversible.
    await queryRunner.query(`
      ALTER TABLE lesson_completions DROP CONSTRAINT IF EXISTS fk_lesson_completions_lesson_plan;
      ALTER TABLE lesson_plans DROP CONSTRAINT IF EXISTS fk_lesson_plans_chapter;
      ALTER TABLE lesson_plans DROP CONSTRAINT IF EXISTS fk_lesson_plans_topic;
      ALTER TABLE lesson_plans DROP CONSTRAINT IF EXISTS fk_lesson_plans_syllabus_plan;
      ALTER TABLE lesson_plans DROP COLUMN IF EXISTS syllabus_plan_id;
      ALTER TABLE subjects DROP COLUMN IF EXISTS progress;
      ALTER TABLE subjects DROP COLUMN IF EXISTS status;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS syllabus_topic_progress;`);
  }
}
