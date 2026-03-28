import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPYQSystem1700000000006 implements MigrationInterface {
  name = 'AddPYQSystem1700000000006';

  async up(qr: QueryRunner): Promise<void> {
    // ── 1. Add new columns to questions ─────────────────────────────────────
    await qr.query(`
      ALTER TABLE questions
        ADD COLUMN IF NOT EXISTS is_verified     BOOLEAN      DEFAULT false,
        ADD COLUMN IF NOT EXISTS pyq_exam        VARCHAR(30),
        ADD COLUMN IF NOT EXISTS pyq_shift       VARCHAR(10),
        ADD COLUMN IF NOT EXISTS pyq_set         VARCHAR(10),
        ADD COLUMN IF NOT EXISTS is_global       BOOLEAN      DEFAULT false,
        ADD COLUMN IF NOT EXISTS view_count      INTEGER      DEFAULT 0,
        ADD COLUMN IF NOT EXISTS correct_attempt_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS wrong_attempt_count   INTEGER DEFAULT 0
    `);

    // Back-fill pyq_exam from pyq_paper for existing PYQ rows, and mark them verified
    await qr.query(`
      UPDATE questions
         SET pyq_exam    = COALESCE(pyq_exam, pyq_paper),
             is_verified = true,
             is_global   = true
       WHERE source = 'pyq'
    `);

    // Index for student-facing queries (topic + verified + exam + year)
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_questions_pyq
        ON questions(topic_id, source, is_verified, pyq_exam, pyq_year)
        WHERE source = 'pyq'
    `);

    // ── 2. pyq_attempts table ────────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pyq_attempts (
        id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             UUID        NOT NULL,
        student_id            UUID        NOT NULL,
        question_id           UUID        NOT NULL,
        selected_option_ids   JSONB       NOT NULL DEFAULT '[]',
        integer_response      VARCHAR(50),
        is_correct            BOOLEAN     NOT NULL,
        time_taken_seconds    INTEGER     NOT NULL DEFAULT 0,
        xp_awarded            INTEGER     NOT NULL DEFAULT 0,
        attempted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_pyq_attempt UNIQUE(student_id, question_id)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_pyq_attempts_student ON pyq_attempts(student_id, question_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_pyq_attempts_tenant  ON pyq_attempts(tenant_id, student_id)`);

    // ── 3. pyq_year_stats table ──────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS pyq_year_stats (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_id        UUID        NOT NULL,
        pyq_exam        VARCHAR(30) NOT NULL,
        pyq_year        INTEGER     NOT NULL,
        question_count  INTEGER     NOT NULL DEFAULT 0,
        easy_count      INTEGER     NOT NULL DEFAULT 0,
        medium_count    INTEGER     NOT NULL DEFAULT 0,
        hard_count      INTEGER     NOT NULL DEFAULT 0,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_pyq_year_stats UNIQUE(topic_id, pyq_exam, pyq_year)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_pyq_year_stats_topic ON pyq_year_stats(topic_id, pyq_exam)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS pyq_year_stats`);
    await qr.query(`DROP TABLE IF EXISTS pyq_attempts`);
    await qr.query(`DROP INDEX IF EXISTS idx_questions_pyq`);
    await qr.query(`
      ALTER TABLE questions
        DROP COLUMN IF EXISTS is_verified,
        DROP COLUMN IF EXISTS pyq_exam,
        DROP COLUMN IF EXISTS pyq_shift,
        DROP COLUMN IF EXISTS pyq_set,
        DROP COLUMN IF EXISTS is_global,
        DROP COLUMN IF EXISTS view_count,
        DROP COLUMN IF EXISTS correct_attempt_count,
        DROP COLUMN IF EXISTS wrong_attempt_count
    `);
  }
}
