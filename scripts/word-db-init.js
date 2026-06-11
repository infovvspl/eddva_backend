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

    // 1. Create word_master_scores table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "word_master_scores" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "game_session_id" uuid NOT NULL,
        "student_id" uuid NOT NULL,
        "words_attempted" integer NOT NULL DEFAULT 0,
        "correct_answers" integer NOT NULL DEFAULT 0,
        "score" double precision NOT NULL DEFAULT 0,
        "max_streak" integer NOT NULL DEFAULT 0,
        "deck_category" character varying NOT NULL,
        "difficulty" character varying NOT NULL DEFAULT 'medium',
        CONSTRAINT "PK_word_master_scores" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_word_master_scores_session" UNIQUE ("game_session_id")
      );
    `);
    console.log('Created word_master_scores table.');

    // 2. Add FK to game_sessions
    try {
      await client.query(`
        ALTER TABLE "word_master_scores" 
        ADD CONSTRAINT "FK_word_master_scores_session" 
        FOREIGN KEY ("game_session_id") REFERENCES "game_sessions"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to game_sessions.');
    } catch (e) {
      console.log('FK_word_master_scores_session might already exist:', e.message);
    }

    // 3. Add FK to students
    try {
      await client.query(`
        ALTER TABLE "word_master_scores" 
        ADD CONSTRAINT "FK_word_master_scores_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students.');
    } catch (e) {
      console.log('FK_word_master_scores_student might already exist:', e.message);
    }

    console.log('Word Master database tables initialized successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
