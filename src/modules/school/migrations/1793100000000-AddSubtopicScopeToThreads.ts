import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subtopic-scoped threads: a subtopic gets its own video/notes/quiz/
 * assessment/chat instead of sharing its parent topic's. `learning_threads`
 * gains `subtopic_id`, and `scope` widens to allow it.
 *
 * Invariant (relied on throughout LearningThreadService and home/mind-map.ts):
 * a `scope = 'subtopic'` row still sets `topic_id` too, to its parent topic —
 * every existing join keys off `topic_id`, so it must never be null here.
 *
 * `uq_learning_threads_subtopic` has no status filter, deliberately matching
 * `uq_learning_threads_topic`'s own shape: one subtopic-thread per student per
 * subtopic, ever — not just one "active" one. Reopening a completed subtopic
 * is a different, not-yet-built feature.
 */
export class AddSubtopicScopeToThreads1793100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_threads ADD COLUMN IF NOT EXISTS subtopic_id UUID REFERENCES learning_roadmap_subtopics(id);

      ALTER TABLE learning_threads DROP CONSTRAINT IF EXISTS ck_learning_threads_scope;
      ALTER TABLE learning_threads ADD CONSTRAINT ck_learning_threads_scope CHECK (scope IN ('topic', 'subtopic', 'general'));

      ALTER TABLE learning_threads DROP CONSTRAINT IF EXISTS ck_learning_threads_subtopic;
      ALTER TABLE learning_threads ADD CONSTRAINT ck_learning_threads_subtopic CHECK (scope != 'subtopic' OR subtopic_id IS NOT NULL);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_threads_subtopic ON learning_threads (student_id, subtopic_id) WHERE scope = 'subtopic';
      CREATE INDEX IF NOT EXISTS idx_learning_threads_subtopic ON learning_threads (subtopic_id) WHERE subtopic_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_learning_threads_subtopic;
      DROP INDEX IF EXISTS uq_learning_threads_subtopic;
      ALTER TABLE learning_threads DROP CONSTRAINT IF EXISTS ck_learning_threads_subtopic;
      ALTER TABLE learning_threads DROP CONSTRAINT IF EXISTS ck_learning_threads_scope;
      ALTER TABLE learning_threads ADD CONSTRAINT ck_learning_threads_scope CHECK (scope IN ('topic', 'general'));
      ALTER TABLE learning_threads DROP COLUMN IF EXISTS subtopic_id;
    `);
  }
}
