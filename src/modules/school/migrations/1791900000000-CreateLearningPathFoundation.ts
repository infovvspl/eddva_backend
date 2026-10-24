import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foundation for the AI learning path (Phase 1).
 *
 * - learning_norm_name(): one normalisation for matching topic names, used by
 *   the backfill below and by the evidence ingestor at read time.
 * - student_topic_evidence: every score the mastery engine learns from. Rows
 *   derived from assessments, assignments, games and the old planner's quiz are
 *   rebuilt per student by the ingestor; dedupe_key makes direct writes
 *   idempotent. Source weights are deliberately not stored, so changing an
 *   institute's weights re-weights past evidence too.
 * - student_topic_mastery / student_chapter_mastery: the engine's output.
 * - learning_path_settings: per-institute overrides of the engine config.
 * - learning_ingest_watermarks: how far the change scan has read each source.
 * - assignment_questions.topic_id: backfilled from the free-text topic_name
 *   where exactly one topic of the assignment's subject matches.
 */
export class CreateLearningPathFoundation1791900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION learning_norm_name(input TEXT) RETURNS TEXT
      LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
        SELECT NULLIF(btrim(regexp_replace(regexp_replace(lower(COALESCE(input, '')), '[^[:alnum:][:space:]]', ' ', 'g'), '\\s+', ' ', 'g')), '')
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_topic_evidence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        student_id UUID NOT NULL,
        subject_id UUID,
        chapter_id UUID,
        topic_id UUID,
        concept_tag VARCHAR(200),
        source VARCHAR(32) NOT NULL,
        source_ref_id VARCHAR(100) NOT NULL,
        dedupe_key VARCHAR(400) NOT NULL,
        correct NUMERIC(8,2),
        total NUMERIC(8,2),
        pct NUMERIC(5,2) NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_student_topic_evidence_scope CHECK (topic_id IS NOT NULL OR chapter_id IS NOT NULL),
        CONSTRAINT ck_student_topic_evidence_pct CHECK (pct >= 0 AND pct <= 100),
        CONSTRAINT ck_student_topic_evidence_source CHECK (source IN ('assessment','ai_assessment','assignment','ai_quiz','ai_quiz_legacy','game')),
        CONSTRAINT uq_student_topic_evidence UNIQUE (student_id, dedupe_key)
      );
      CREATE INDEX IF NOT EXISTS idx_student_topic_evidence_student_source ON student_topic_evidence (student_id, source);
      CREATE INDEX IF NOT EXISTS idx_student_topic_evidence_topic ON student_topic_evidence (topic_id) WHERE topic_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_topic_mastery (
        student_id UUID NOT NULL,
        topic_id UUID NOT NULL,
        institute_id UUID,
        subject_id UUID NOT NULL,
        chapter_id UUID NOT NULL,
        mastery NUMERIC(5,2),
        confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
        status VARCHAR(24) NOT NULL,
        est_minutes INT NOT NULL DEFAULT 0,
        evidence_count INT NOT NULL DEFAULT 0,
        last_evidence_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (student_id, topic_id)
      );
      CREATE INDEX IF NOT EXISTS idx_student_topic_mastery_status ON student_topic_mastery (student_id, status);
      CREATE INDEX IF NOT EXISTS idx_student_topic_mastery_subject ON student_topic_mastery (institute_id, subject_id, status);

      CREATE TABLE IF NOT EXISTS student_chapter_mastery (
        student_id UUID NOT NULL,
        chapter_id UUID NOT NULL,
        institute_id UUID,
        subject_id UUID NOT NULL,
        mastery NUMERIC(5,2),
        confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
        status VARCHAR(24) NOT NULL,
        est_minutes INT NOT NULL DEFAULT 0,
        evidence_count INT NOT NULL DEFAULT 0,
        weak_topics INT NOT NULL DEFAULT 0,
        at_risk_topics INT NOT NULL DEFAULT 0,
        last_evidence_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (student_id, chapter_id)
      );
      CREATE INDEX IF NOT EXISTS idx_student_chapter_mastery_status ON student_chapter_mastery (student_id, status);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_path_settings (
        institute_id UUID PRIMARY KEY,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS learning_ingest_watermarks (
        source VARCHAR(64) PRIMARY KEY,
        last_seen_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const hasQuestions = await queryRunner.query(`SELECT to_regclass('public.assignment_questions') AS t`);
    if (hasQuestions?.[0]?.t) {
      await queryRunner.query(`ALTER TABLE assignment_questions ADD COLUMN IF NOT EXISTS topic_id UUID NULL`);
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS idx_assignment_questions_topic ON assignment_questions (topic_id) WHERE topic_id IS NOT NULL`,
      );
      // Ambiguous names (more than one topic of the subject normalises the same) stay NULL.
      await queryRunner.query(`
        UPDATE assignment_questions aq
           SET topic_id = m.topic_id::uuid
          FROM (
            SELECT aq2.id AS question_id, MIN(t.id::text) AS topic_id
              FROM assignment_questions aq2
              JOIN assignments a ON a.id::text = aq2.assignment_id::text
              JOIN chapters c ON c.subject_id::text = a.subject_id::text
              JOIN topics t ON t.chapter_id::text = c.id::text
             WHERE aq2.topic_id IS NULL
               AND learning_norm_name(aq2.topic_name) IS NOT NULL
               AND learning_norm_name(t.name) = learning_norm_name(aq2.topic_name)
             GROUP BY aq2.id
            HAVING COUNT(DISTINCT t.id) = 1
          ) m
         WHERE aq.id = m.question_id
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_assignment_questions_topic`);
    const hasQuestions = await queryRunner.query(`SELECT to_regclass('public.assignment_questions') AS t`);
    if (hasQuestions?.[0]?.t) {
      await queryRunner.query(`ALTER TABLE assignment_questions DROP COLUMN IF EXISTS topic_id`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS learning_ingest_watermarks`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_path_settings`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_chapter_mastery`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_topic_mastery`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_topic_evidence`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS learning_norm_name(TEXT)`);
  }
}
