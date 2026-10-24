import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI-generated chapter roadmaps: the topics and subtopics the learning path
 * works on, replacing the school's recorded topics as its unit of learning.
 *
 * - learning_roadmaps: one per chapter (shared by the school): generated once,
 *   or a one-topic fallback after repeated AI failures so a weak chapter is
 *   never a dead end.
 * - learning_roadmap_topics: the topics in teaching order, each with its
 *   subtopics. Their ids are what threads, quizzes, notes, mastery, videos and
 *   engagement refer to as topic_id from now on; none of those tables has a
 *   foreign key to the school's topics table.
 * - learning_roadmap_topic_links: which roadmap topic covers each of the
 *   school's recorded topics, so teacher marks tagged with a recorded topic
 *   still count for the right roadmap topic. The school's topics are never
 *   modified.
 *
 * Replaces topic_subtopics (subtopic outlines of recorded topics, superseded).
 */
export class CreateLearningRoadmaps1792400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS topic_subtopics;

      CREATE TABLE IF NOT EXISTS learning_roadmaps (
        chapter_id UUID PRIMARY KEY,
        institute_id UUID,
        status VARCHAR(16) NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'ai',
        attempts INT NOT NULL DEFAULT 0,
        generated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_learning_roadmaps_status CHECK (status IN ('ready', 'failed')),
        CONSTRAINT ck_learning_roadmaps_source CHECK (source IN ('ai', 'fallback', 'teacher'))
      );

      CREATE TABLE IF NOT EXISTS learning_roadmap_topics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chapter_id UUID NOT NULL REFERENCES learning_roadmaps(chapter_id) ON DELETE CASCADE,
        ord INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        subtopics JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_learning_roadmap_topics_order UNIQUE (chapter_id, ord)
      );

      CREATE TABLE IF NOT EXISTS learning_roadmap_topic_links (
        curriculum_topic_id UUID PRIMARY KEY,
        roadmap_topic_id UUID NOT NULL REFERENCES learning_roadmap_topics(id) ON DELETE CASCADE,
        chapter_id UUID NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_learning_roadmap_links_roadmap ON learning_roadmap_topic_links (roadmap_topic_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS learning_roadmap_topic_links`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_roadmap_topics`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_roadmaps`);
  }
}
