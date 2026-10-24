import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Active-time tracking for the learning path (engagement reports).
 *
 * - learning_activity_state: one row per student, locked by every heartbeat.
 *   last_credit_at is what stops time being over-counted: a student is never
 *   credited more active seconds than wall-clock time since the last credit,
 *   so two open tabs or a replayed batch cannot inflate it.
 * - learning_activity_sessions: one row per continuous visit to a section
 *   (staff "activity timeline"). Durations only, never content.
 * - learning_engagement_daily: per student, day (IST), subject, topic and
 *   section; every report and trend reads this, not the sessions.
 */
export class CreateLearningActivity1792200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS learning_activity_state (
        student_id UUID PRIMARY KEY,
        last_credit_at TIMESTAMPTZ,
        current_session_id UUID,
        current_key VARCHAR(200),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS learning_activity_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        student_id UUID NOT NULL,
        section VARCHAR(16) NOT NULL,
        thread_id UUID,
        step_id UUID,
        subject_id UUID,
        topic_id UUID,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        active_seconds INT NOT NULL DEFAULT 0,
        device VARCHAR(16),
        CONSTRAINT ck_learning_activity_section CHECK (section IN ('home', 'videos', 'notes', 'quiz', 'assessment', 'chat'))
      );
      CREATE INDEX IF NOT EXISTS idx_learning_activity_sessions_student ON learning_activity_sessions (student_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_activity_sessions_institute ON learning_activity_sessions (institute_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS learning_engagement_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        student_id UUID NOT NULL,
        day DATE NOT NULL,
        subject_id UUID,
        topic_id UUID,
        section VARCHAR(16) NOT NULL,
        active_seconds INT NOT NULL DEFAULT 0,
        visits INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_engagement_daily ON learning_engagement_daily (
        student_id, day,
        (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        (COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        section
      );
      CREATE INDEX IF NOT EXISTS idx_learning_engagement_daily_institute ON learning_engagement_daily (institute_id, day);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS learning_engagement_daily`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_activity_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS learning_activity_state`);
  }
}
