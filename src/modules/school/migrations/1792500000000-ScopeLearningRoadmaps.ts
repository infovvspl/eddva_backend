import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmaps only where a student is weak:
 *   - a weak chapter gets a chapter roadmap (its topics, each with subtopics);
 *   - a weak topic in a chapter that is otherwise fine gets a topic roadmap
 *     (just that topic's subtopics).
 *
 * learning_roadmaps now records one generation per chapter roadmap
 * (curriculum_topic_id NULL) or per topic roadmap (curriculum_topic_id set).
 * learning_roadmap_topics no longer hangs off one roadmap row: a topic made by
 * a topic roadmap has ord NULL, and is reused (given an ord) if its chapter
 * later becomes weak, so the student's chat and progress on it carry over.
 * The 'teacher' source is gone: roadmaps are for students only.
 *
 * The tables replaced here only ever held test data, so they are rebuilt.
 */
export class ScopeLearningRoadmaps1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS learning_roadmap_topic_links;
      DROP TABLE IF EXISTS learning_roadmap_topics;
      DROP TABLE IF EXISTS learning_roadmaps;

      CREATE TABLE learning_roadmaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(16) NOT NULL,
        chapter_id UUID NOT NULL,
        curriculum_topic_id UUID,
        institute_id UUID,
        status VARCHAR(16) NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'ai',
        attempts INT NOT NULL DEFAULT 0,
        generated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_learning_roadmaps_kind CHECK (
          (kind = 'chapter' AND curriculum_topic_id IS NULL) OR (kind = 'topic' AND curriculum_topic_id IS NOT NULL)
        ),
        CONSTRAINT ck_learning_roadmaps_status CHECK (status IN ('ready', 'failed')),
        CONSTRAINT ck_learning_roadmaps_source CHECK (source IN ('ai', 'fallback'))
      );
      CREATE UNIQUE INDEX uq_learning_roadmaps_chapter ON learning_roadmaps (chapter_id) WHERE kind = 'chapter';
      CREATE UNIQUE INDEX uq_learning_roadmaps_topic ON learning_roadmaps (curriculum_topic_id) WHERE kind = 'topic';

      CREATE TABLE learning_roadmap_topics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chapter_id UUID NOT NULL,
        ord INT,
        name VARCHAR(160) NOT NULL,
        subtopics JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX uq_learning_roadmap_topics_order ON learning_roadmap_topics (chapter_id, ord) WHERE ord IS NOT NULL;
      CREATE INDEX idx_learning_roadmap_topics_chapter ON learning_roadmap_topics (chapter_id);

      CREATE TABLE learning_roadmap_topic_links (
        curriculum_topic_id UUID PRIMARY KEY,
        roadmap_topic_id UUID NOT NULL REFERENCES learning_roadmap_topics(id) ON DELETE CASCADE,
        chapter_id UUID NOT NULL
      );
      CREATE INDEX idx_learning_roadmap_links_roadmap ON learning_roadmap_topic_links (roadmap_topic_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS learning_roadmap_topic_links;
      DROP TABLE IF EXISTS learning_roadmap_topics;
      DROP TABLE IF EXISTS learning_roadmaps;

      CREATE TABLE learning_roadmaps (
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
      CREATE TABLE learning_roadmap_topics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chapter_id UUID NOT NULL REFERENCES learning_roadmaps(chapter_id) ON DELETE CASCADE,
        ord INT NOT NULL,
        name VARCHAR(160) NOT NULL,
        subtopics JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_learning_roadmap_topics_order UNIQUE (chapter_id, ord)
      );
      CREATE TABLE learning_roadmap_topic_links (
        curriculum_topic_id UUID PRIMARY KEY,
        roadmap_topic_id UUID NOT NULL REFERENCES learning_roadmap_topics(id) ON DELETE CASCADE,
        chapter_id UUID NOT NULL
      );
    `);
  }
}
