import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the 10 coaching gamification tables that were previously managed by
 * TypeORM synchronize:true. Proper migrations prevent accidental column drops
 * or schema drift during deploys.
 */
export class AddGamificationTables1782400000000 implements MigrationInterface {
  name = 'AddGamificationTables1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "game_sessions" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"   TIMESTAMPTZ,
        "tenant_id"    UUID NOT NULL,
        "student_id"   UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "game_type"    VARCHAR NOT NULL,
        "status"       VARCHAR NOT NULL DEFAULT 'active',
        "xp_earned"    INTEGER NOT NULL DEFAULT 0,
        "coins_earned" INTEGER NOT NULL DEFAULT 0,
        "metadata"     JSONB
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_game_sessions_tenant_student" ON "game_sessions" ("tenant_id", "student_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quiz_rush_scores" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        "game_session_id"  UUID UNIQUE NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
        "student_id"       UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "total_questions"  INTEGER NOT NULL DEFAULT 0,
        "correct_answers"  INTEGER NOT NULL DEFAULT 0,
        "score"            FLOAT NOT NULL DEFAULT 0,
        "max_streak"       INTEGER NOT NULL DEFAULT 0,
        "time_taken_seconds" INTEGER NOT NULL DEFAULT 0
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quests" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "tenant_id"  UUID NOT NULL,
        "name"       VARCHAR NOT NULL,
        "description" VARCHAR,
        "map_type"   VARCHAR NOT NULL DEFAULT 'forest',
        "subject_id" UUID,
        "chapter_id" UUID,
        "difficulty" VARCHAR NOT NULL DEFAULT 'medium',
        "class"      VARCHAR
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quest_stages" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMPTZ,
        "quest_id"       UUID NOT NULL REFERENCES "quests"("id") ON DELETE CASCADE,
        "name"           VARCHAR NOT NULL,
        "stage_order"    INTEGER NOT NULL,
        "question_count" INTEGER NOT NULL DEFAULT 3,
        "xp_reward"      INTEGER NOT NULL DEFAULT 30,
        "coins_reward"   INTEGER NOT NULL DEFAULT 5,
        "badge_reward"   VARCHAR
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "student_quests" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        "student_id"          UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "quest_id"            UUID NOT NULL REFERENCES "quests"("id") ON DELETE CASCADE,
        "current_stage_order" INTEGER NOT NULL DEFAULT 1,
        "status"              VARCHAR NOT NULL DEFAULT 'active',
        "completed_at"        TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_student_quests_student" ON "student_quests" ("student_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quest_rewards" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMPTZ,
        "student_id"  UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "reward_type" VARCHAR NOT NULL,
        "value"       VARCHAR NOT NULL,
        "is_claimed"  BOOLEAN NOT NULL DEFAULT false,
        "claimed_at"  TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "math_sprint_scores" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"           TIMESTAMPTZ,
        "game_session_id"      UUID UNIQUE NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
        "student_id"           UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "questions_attempted"  INTEGER NOT NULL DEFAULT 0,
        "correct_answers"      INTEGER NOT NULL DEFAULT 0,
        "score"                FLOAT NOT NULL DEFAULT 0,
        "max_streak"           INTEGER NOT NULL DEFAULT 0,
        "difficulty"           VARCHAR NOT NULL DEFAULT 'medium'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "memory_match_scores" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        "game_session_id"  UUID UNIQUE NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
        "student_id"       UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "turns_count"      INTEGER NOT NULL DEFAULT 0,
        "mismatches_count" INTEGER NOT NULL DEFAULT 0,
        "score"            FLOAT NOT NULL DEFAULT 0,
        "deck_category"    VARCHAR NOT NULL,
        "difficulty"       VARCHAR NOT NULL DEFAULT 'medium'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "word_master_scores" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        "game_session_id"  UUID UNIQUE NOT NULL REFERENCES "game_sessions"("id") ON DELETE CASCADE,
        "student_id"       UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "words_attempted"  INTEGER NOT NULL DEFAULT 0,
        "correct_answers"  INTEGER NOT NULL DEFAULT 0,
        "score"            FLOAT NOT NULL DEFAULT 0,
        "max_streak"       INTEGER NOT NULL DEFAULT 0,
        "deck_category"    VARCHAR NOT NULL,
        "difficulty"       VARCHAR NOT NULL DEFAULT 'medium'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gamification_history" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"   TIMESTAMPTZ,
        "student_id"   UUID NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
        "game_type"    VARCHAR NOT NULL,
        "xp_earned"    INTEGER NOT NULL DEFAULT 0,
        "coins_earned" INTEGER NOT NULL DEFAULT 0,
        "score"        FLOAT NOT NULL DEFAULT 0,
        "metadata"     JSONB
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_gamification_history_student" ON "gamification_history" ("student_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "gamification_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "word_master_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "memory_match_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "math_sprint_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quest_rewards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "student_quests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quest_stages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "quiz_rush_scores"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "game_sessions"`);
  }
}
