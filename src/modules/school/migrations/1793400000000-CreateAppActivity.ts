import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * App-wide, per-category active-time tracking (screen-time "detailed report").
 *
 * Mirrors learning_activity_state / learning_activity_sessions /
 * learning_engagement_daily (see CreateLearningActivity1792200000000) exactly,
 * but keyed by user_id (every school role, like school_screen_time_daily) and
 * covering every page category instead of just the AI Learning Path. Fully
 * additive — the learning_activity_* tables are untouched.
 */
export class CreateAppActivity1793400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_activity_state (
        user_id UUID PRIMARY KEY,
        last_credit_at TIMESTAMPTZ,
        current_session_id UUID,
        current_key VARCHAR(200),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS school_activity_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        user_id UUID NOT NULL,
        category VARCHAR(24) NOT NULL,
        ref_id VARCHAR(64),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        active_seconds INT NOT NULL DEFAULT 0,
        device VARCHAR(16),
        CONSTRAINT ck_school_activity_category CHECK (category IN (
          'games', 'study_materials', 'assignments', 'assessments_other',
          'doubts', 'career', 'video_lectures', 'battle_arena', 'chat_ai', 'nav'
        ))
      );
      CREATE INDEX IF NOT EXISTS idx_school_activity_sessions_user ON school_activity_sessions (user_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_school_activity_sessions_institute ON school_activity_sessions (institute_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS school_activity_daily (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID,
        user_id UUID NOT NULL,
        day DATE NOT NULL,
        category VARCHAR(24) NOT NULL,
        active_seconds INT NOT NULL DEFAULT 0,
        visits INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_school_activity_daily ON school_activity_daily (user_id, day, category);
      CREATE INDEX IF NOT EXISTS idx_school_activity_daily_institute ON school_activity_daily (institute_id, day);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS school_activity_daily`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_activity_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_activity_state`);
  }
}
