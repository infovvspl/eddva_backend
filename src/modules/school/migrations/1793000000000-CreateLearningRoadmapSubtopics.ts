import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stable ids for a roadmap topic's subtopics, kept in step with (but not
 * replacing) `learning_roadmap_topics.subtopics` JSONB, which stays the
 * source of truth for the plain name lists AI prompts and quiz concepts
 * still read. This table is the source of truth for subtopic *identity*,
 * so a thread, or a mastery row, can point at one subtopic across AI
 * roadmap regenerations instead of only matching it by name each time.
 *
 * A subtopic row is never hard-deleted (only marked inactive), so anything
 * that already points at one (a thread, a mastery row) keeps a valid id —
 * the FK from learning_threads added later relies on this.
 */
export class CreateLearningRoadmapSubtopics1793000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_roadmap_subtopics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        roadmap_topic_id UUID NOT NULL REFERENCES learning_roadmap_topics(id) ON DELETE CASCADE,
        ord INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_roadmap_subtopics_order ON learning_roadmap_subtopics (roadmap_topic_id, ord) WHERE active;
      CREATE INDEX IF NOT EXISTS idx_learning_roadmap_subtopics_topic ON learning_roadmap_subtopics (roadmap_topic_id);
    `);

    // One-time backfill: one row per existing subtopics[] element, in order. Guarded against a
    // non-array legacy value and safe to re-run (e.g. a dev reset) since it skips topics that
    // already have rows.
    await queryRunner.query(`
      INSERT INTO learning_roadmap_subtopics (roadmap_topic_id, ord, name)
      SELECT t.id, row_number() OVER (PARTITION BY t.id ORDER BY elem.idx), elem.name
        FROM learning_roadmap_topics t,
             jsonb_array_elements_text(t.subtopics) WITH ORDINALITY AS elem(name, idx)
       WHERE jsonb_typeof(t.subtopics) = 'array'
         AND NOT EXISTS (SELECT 1 FROM learning_roadmap_subtopics x WHERE x.roadmap_topic_id = t.id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS learning_roadmap_subtopics`);
  }
}
