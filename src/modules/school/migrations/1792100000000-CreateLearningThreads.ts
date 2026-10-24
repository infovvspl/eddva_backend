import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learning threads for the AI learning path (Phase 3): one chat per mind-map
 * node, holding the curved path of steps and the full message history.
 *
 * - learning_threads: one per (student, topic), plus one "general" chat per
 *   student. A prerequisite suggested by the engine is a thread with
 *   parent_thread_id set and status 'suggested' until the student opens it.
 * - learning_thread_steps: four per round (videos, notes, quiz, assessment).
 *   A later round's steps carry the concepts it focuses on.
 * - learning_thread_messages: append-only, never capped or rewritten.
 *   clock_timestamp() keeps messages written in one transaction in order.
 * - topic_video_cache: YouTube results per topic (and focus), so a popular
 *   topic does not spend search quota for every student.
 */
export class CreateLearningThreads1792100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        student_id UUID NOT NULL,
        scope VARCHAR(16) NOT NULL,
        subject_id UUID,
        chapter_id UUID,
        topic_id UUID,
        parent_thread_id UUID REFERENCES learning_threads(id) ON DELETE SET NULL,
        origin VARCHAR(24) NOT NULL DEFAULT 'mind_map',
        status VARCHAR(24) NOT NULL DEFAULT 'active',
        current_round INT NOT NULL DEFAULT 1,
        current_step_id UUID,
        weak_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
        baseline_mastery NUMERIC(5,2),
        baseline_at TIMESTAMPTZ,
        latest_mastery NUMERIC(5,2),
        message_count INT NOT NULL DEFAULT 0,
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_learning_threads_scope CHECK (scope IN ('topic', 'general')),
        CONSTRAINT ck_learning_threads_topic CHECK (scope = 'general' OR topic_id IS NOT NULL),
        CONSTRAINT ck_learning_threads_origin CHECK (origin IN ('mind_map', 'prerequisite', 'general')),
        CONSTRAINT ck_learning_threads_status CHECK (status IN ('suggested', 'active', 'completed', 'needs_teacher'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_threads_topic ON learning_threads (student_id, topic_id) WHERE scope = 'topic';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_threads_general ON learning_threads (student_id) WHERE scope = 'general';
      CREATE INDEX IF NOT EXISTS idx_learning_threads_student_activity ON learning_threads (student_id, last_activity_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_threads_parent ON learning_threads (parent_thread_id) WHERE parent_thread_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS learning_thread_steps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id UUID NOT NULL REFERENCES learning_threads(id) ON DELETE CASCADE,
        round INT NOT NULL,
        ordinal INT NOT NULL,
        kind VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'locked',
        focus_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
        ref_id UUID,
        content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_learning_thread_steps_kind CHECK (kind IN ('videos', 'notes', 'quiz', 'assessment')),
        CONSTRAINT ck_learning_thread_steps_status CHECK (status IN ('locked', 'active', 'done', 'skipped')),
        CONSTRAINT uq_learning_thread_steps UNIQUE (thread_id, round, kind)
      );

      CREATE TABLE IF NOT EXISTS learning_thread_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id UUID NOT NULL REFERENCES learning_threads(id) ON DELETE CASCADE,
        step_id UUID,
        round INT,
        role VARCHAR(12) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        content_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT ck_learning_thread_messages_role CHECK (role IN ('student', 'ai', 'system'))
      );
      CREATE INDEX IF NOT EXISTS idx_learning_thread_messages_page ON learning_thread_messages (thread_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS topic_video_cache (
        institute_id UUID NOT NULL,
        cache_key VARCHAR(300) NOT NULL,
        topic_id UUID NOT NULL,
        videos_json JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (institute_id, cache_key)
      );
    `);

    // Quiz instances made before threads existed keep a NULL thread_id; deleting a thread unlinks, never deletes, its graded attempts.
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_learning_quiz_instances_thread') THEN
          ALTER TABLE learning_quiz_instances
            ADD CONSTRAINT fk_learning_quiz_instances_thread FOREIGN KEY (thread_id) REFERENCES learning_threads(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE learning_quiz_instances DROP CONSTRAINT IF EXISTS fk_learning_quiz_instances_thread`);
    await queryRunner.query(`DROP TABLE IF EXISTS topic_video_cache`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_thread_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_thread_steps`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_threads`);
  }
}
