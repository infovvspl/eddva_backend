const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const connectionString = process.env.COACHING_DB_URL;
  if (!connectionString) {
    console.error('Error: COACHING_DB_URL is not set in environment.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to coaching DB.');

    // 1. Add eddva_coins column to students if not exists
    await client.query(`
      ALTER TABLE "students" 
      ADD COLUMN IF NOT EXISTS "eddva_coins" integer DEFAULT 0;
    `);
    console.log('Added eddva_coins column if not exists.');

    await client.query(`
      ALTER TABLE "students" 
      ADD COLUMN IF NOT EXISTS "unlocked_badges" jsonb DEFAULT '[]'::jsonb;
    `);
    console.log('Added unlocked_badges column if not exists.');

    // 2. Create game_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "game_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "game_type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "xp_earned" integer NOT NULL DEFAULT 0,
        "coins_earned" integer NOT NULL DEFAULT 0,
        "metadata" jsonb,
        CONSTRAINT "PK_game_sessions" PRIMARY KEY ("id")
      );
    `);
    console.log('Created game_sessions table.');

    // Add foreign keys for game_sessions
    try {
      await client.query(`
        ALTER TABLE "game_sessions" 
        ADD CONSTRAINT "FK_game_sessions_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students on game_sessions.');
    } catch (e) {
      console.log('FK_game_sessions_student might already exist:', e.message);
    }

    try {
      await client.query(`
        ALTER TABLE "game_sessions" 
        ADD CONSTRAINT "FK_game_sessions_tenant" 
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to tenants on game_sessions.');
    } catch (e) {
      console.log('FK_game_sessions_tenant might already exist:', e.message);
    }

    // 3. Create quiz_rush_scores table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "quiz_rush_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "game_session_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "total_questions" integer NOT NULL DEFAULT 0,
        "correct_answers" integer NOT NULL DEFAULT 0,
        "score" double precision NOT NULL DEFAULT 0,
        "max_streak" integer NOT NULL DEFAULT 0,
        "time_taken_seconds" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_quiz_rush_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quiz_rush_scores_session" UNIQUE ("game_session_id")
      );
    `);
    console.log('Created quiz_rush_scores table.');

    // Add foreign keys for quiz_rush_scores
    try {
      await client.query(`
        ALTER TABLE "quiz_rush_scores" 
        ADD CONSTRAINT "FK_quiz_rush_scores_session" 
        FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to game_sessions on quiz_rush_scores.');
    } catch (e) {
      console.log('FK_quiz_rush_scores_session might already exist:', e.message);
    }

    try {
      await client.query(`
        ALTER TABLE "quiz_rush_scores" 
        ADD CONSTRAINT "FK_quiz_rush_scores_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students on quiz_rush_scores.');
    } catch (e) {
      console.log('FK_quiz_rush_scores_student might already exist:', e.message);
    }

    // 4. Create gamification_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "gamification_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "student_id" uuid NOT NULL,
        "game_type" character varying NOT NULL,
        "xp_earned" integer NOT NULL DEFAULT 0,
        "coins_earned" integer NOT NULL DEFAULT 0,
        "score" double precision NOT NULL DEFAULT 0,
        "metadata" jsonb,
        CONSTRAINT "PK_gamification_history" PRIMARY KEY ("id")
      );
    `);
    console.log('Created gamification_history table.');

    try {
      await client.query(`
        ALTER TABLE "gamification_history" 
        ADD CONSTRAINT "FK_gamification_history_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students on gamification_history.');
    } catch (e) {
      console.log('FK_gamification_history_student might already exist:', e.message);
    }

    console.log('All DB changes executed successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
