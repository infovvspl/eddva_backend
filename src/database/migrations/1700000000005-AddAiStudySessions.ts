import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiStudySessions1700000000005 implements MigrationInterface {
  name = 'AddAiStudySessions1700000000005';

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── Create ai_study_sessions table ──────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "ai_study_sessions" (
        "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id"            UUID          NOT NULL,
        "student_id"           UUID          NOT NULL,
        "topic_id"             UUID          NOT NULL,
        "lesson_markdown"      TEXT,
        "key_concepts"         JSONB         NOT NULL DEFAULT '[]',
        "formulas"             JSONB         NOT NULL DEFAULT '[]',
        "practice_questions"   JSONB         NOT NULL DEFAULT '[]',
        "common_mistakes"      JSONB         NOT NULL DEFAULT '[]',
        "conversation"         JSONB         NOT NULL DEFAULT '[]',
        "is_completed"         BOOLEAN       NOT NULL DEFAULT false,
        "time_spent_seconds"   INTEGER       NOT NULL DEFAULT 0,
        "completed_at"         TIMESTAMPTZ,
        "ai_session_ref"       VARCHAR,
        "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        "deleted_at"           TIMESTAMPTZ,
        CONSTRAINT "PK_ai_study_sessions" PRIMARY KEY ("id")
      )
    `);

    // ── Indexes ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_study_sessions_student_topic"
        ON "ai_study_sessions" ("student_id", "topic_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ai_study_sessions_tenant_student"
        ON "ai_study_sessions" ("tenant_id", "student_id")
    `);

    // One active session per student per topic
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ai_study_sessions_student_topic_active"
        ON "ai_study_sessions" ("student_id", "topic_id")
        WHERE "deleted_at" IS NULL
    `);

    // ── Add studied_with_ai to topic_progress ────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "topic_progress"
        ADD COLUMN IF NOT EXISTS "studied_with_ai" BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "topic_progress" DROP COLUMN IF EXISTS "studied_with_ai"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_study_sessions"`);
  }
}
