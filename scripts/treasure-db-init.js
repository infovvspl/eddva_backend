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

    // 1. Create quests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "quests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "tenant_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "description" text,
        "map_type" character varying NOT NULL DEFAULT 'forest',
        "subject_id" uuid,
        "chapter_id" uuid,
        "difficulty" character varying NOT NULL DEFAULT 'medium',
        "class" character varying,
        CONSTRAINT "PK_quests" PRIMARY KEY ("id")
      );
    `);
    console.log('Created quests table.');

    try {
      await client.query(`
        ALTER TABLE "quests" 
        ADD CONSTRAINT "FK_quests_tenant" 
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to tenants on quests.');
    } catch (e) {
      console.log('FK_quests_tenant might already exist:', e.message);
    }

    // 2. Create quest_stages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "quest_stages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "quest_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "stage_order" integer NOT NULL,
        "question_count" integer NOT NULL DEFAULT 3,
        "xp_reward" integer NOT NULL DEFAULT 30,
        "coins_reward" integer NOT NULL DEFAULT 5,
        "badge_reward" character varying,
        CONSTRAINT "PK_quest_stages" PRIMARY KEY ("id")
      );
    `);
    console.log('Created quest_stages table.');

    try {
      await client.query(`
        ALTER TABLE "quest_stages" 
        ADD CONSTRAINT "FK_quest_stages_quest" 
        FOREIGN KEY ("quest_id") REFERENCES "quests"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to quests on quest_stages.');
    } catch (e) {
      console.log('FK_quest_stages_quest might already exist:', e.message);
    }

    // 3. Create student_quests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "student_quests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "student_id" uuid NOT NULL,
        "quest_id" uuid NOT NULL,
        "current_stage_order" integer NOT NULL DEFAULT 1,
        "status" character varying NOT NULL DEFAULT 'active',
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_student_quests" PRIMARY KEY ("id")
      );
    `);
    console.log('Created student_quests table.');

    try {
      await client.query(`
        ALTER TABLE "student_quests" 
        ADD CONSTRAINT "FK_student_quests_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students on student_quests.');
    } catch (e) {
      console.log('FK_student_quests_student might already exist:', e.message);
    }

    try {
      await client.query(`
        ALTER TABLE "student_quests" 
        ADD CONSTRAINT "FK_student_quests_quest" 
        FOREIGN KEY ("quest_id") REFERENCES "quests"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to quests on student_quests.');
    } catch (e) {
      console.log('FK_student_quests_quest might already exist:', e.message);
    }

    // 4. Create quest_rewards table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "quest_rewards" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "student_id" uuid NOT NULL,
        "reward_type" character varying NOT NULL,
        "value" character varying NOT NULL,
        "is_claimed" boolean NOT NULL DEFAULT false,
        "claimed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_quest_rewards" PRIMARY KEY ("id")
      );
    `);
    console.log('Created quest_rewards table.');

    try {
      await client.query(`
        ALTER TABLE "quest_rewards" 
        ADD CONSTRAINT "FK_quest_rewards_student" 
        FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE;
      `);
      console.log('Added FK to students on quest_rewards.');
    } catch (e) {
      console.log('FK_quest_rewards_student might already exist:', e.message);
    }

    console.log('All Treasure Hunt tables initialized successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

run();
