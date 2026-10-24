import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quiz / formal-assessment engine for the AI learning path (Phase 2).
 *
 * - learning_quiz_instances: one generated quiz or assessment. questions_json
 *   holds the answer key and is never sent to the browser before submission;
 *   draft_answers is autosaved so a student can resume, and an assessment's
 *   timer is enforced from expires_at.
 * - learning_quiz_responses: one row per answered question, tagged with the
 *   concept it tests, which is what weak-concept detection reads.
 * - school_ai_study_sessions: notes now belong to a learning-path round; a
 *   later round's notes focus on the concepts the student got wrong.
 *   thread_id stays without a foreign key until the threads table exists.
 */
export class CreateLearningQuizEngine1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_quiz_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        student_id UUID NOT NULL,
        subject_id UUID,
        chapter_id UUID,
        topic_id UUID NOT NULL,
        thread_id UUID,
        step_id UUID,
        round INT NOT NULL DEFAULT 1,
        kind VARCHAR(16) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
        concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
        questions_json JSONB NOT NULL,
        draft_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        submitted_at TIMESTAMPTZ,
        score NUMERIC(6,2),
        total NUMERIC(6,2),
        accuracy NUMERIC(5,2),
        weak_concepts JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_learning_quiz_kind CHECK (kind IN ('quiz', 'assessment')),
        CONSTRAINT ck_learning_quiz_status CHECK (status IN ('in_progress', 'submitted', 'auto_submitted'))
      );
      CREATE INDEX IF NOT EXISTS idx_learning_quiz_instances_student ON learning_quiz_instances (student_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_quiz_instances_thread ON learning_quiz_instances (thread_id) WHERE thread_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS learning_quiz_responses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id UUID NOT NULL REFERENCES learning_quiz_instances(id) ON DELETE CASCADE,
        student_id UUID NOT NULL,
        topic_id UUID NOT NULL,
        question_id VARCHAR(64) NOT NULL,
        concept_tag VARCHAR(200),
        answer VARCHAR(64),
        is_correct BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_learning_quiz_response UNIQUE (instance_id, question_id)
      );
      CREATE INDEX IF NOT EXISTS idx_learning_quiz_responses_student_topic ON learning_quiz_responses (student_id, topic_id);
    `);

    const hasSessions = await queryRunner.query(`SELECT to_regclass('public.school_ai_study_sessions') AS t`);
    if (hasSessions?.[0]?.t) {
      await queryRunner.query(`
        ALTER TABLE school_ai_study_sessions
          ADD COLUMN IF NOT EXISTS thread_id UUID,
          ADD COLUMN IF NOT EXISTS round INT NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS focus_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS last_anchor JSONB;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_school_ai_study_sessions_thread_round
          ON school_ai_study_sessions (thread_id, round) WHERE thread_id IS NOT NULL;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasSessions = await queryRunner.query(`SELECT to_regclass('public.school_ai_study_sessions') AS t`);
    if (hasSessions?.[0]?.t) {
      await queryRunner.query(`DROP INDEX IF EXISTS uq_school_ai_study_sessions_thread_round`);
      await queryRunner.query(`
        ALTER TABLE school_ai_study_sessions
          DROP COLUMN IF EXISTS last_anchor,
          DROP COLUMN IF EXISTS focus_concepts,
          DROP COLUMN IF EXISTS round,
          DROP COLUMN IF EXISTS thread_id
      `);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS learning_quiz_responses`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_quiz_instances`);
  }
}
