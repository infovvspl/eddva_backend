import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subtopic outlines for the learning-path mind map (shared by every student
 * of a school, generated once per topic).
 *
 * A row belongs to a topic, or, for a chapter that has no topics yet, to the
 * chapter itself (topic_id NULL) so that merely viewing the mind map never
 * creates curriculum topics. The subtopics are also the concepts quizzes are
 * tagged with, which is how each subtopic node gets a measured status.
 */
export class CreateTopicSubtopics1792300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS topic_subtopics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        chapter_id UUID NOT NULL,
        topic_id UUID,
        subtopics JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(16) NOT NULL DEFAULT 'ready',
        source VARCHAR(16) NOT NULL DEFAULT 'ai',
        attempts INT NOT NULL DEFAULT 0,
        generated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_topic_subtopics_status CHECK (status IN ('ready', 'failed')),
        CONSTRAINT ck_topic_subtopics_source CHECK (source IN ('ai', 'teacher'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_subtopics_topic ON topic_subtopics (topic_id) WHERE topic_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_subtopics_chapter ON topic_subtopics (chapter_id) WHERE topic_id IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS topic_subtopics`);
  }
}
