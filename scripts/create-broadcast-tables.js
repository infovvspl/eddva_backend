/* One-off: create live-broadcast tables on the coaching DB (idempotent).
   The chain `migration:run` is blocked by older un-applied migrations, so we
   apply just this module's DDL directly. Safe to re-run. */
require('dotenv').config();
const { Client } = require('pg');

const connectionString = process.env.COACHING_DB_URL;
const client = connectionString
  ? new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  : new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'apexiq',
      ssl: { rejectUnauthorized: false },
    });

const SQL = [
  `DO $$ BEGIN
     CREATE TYPE "broadcast_lectures_status_enum" AS ENUM
       ('SCHEDULED','LIVE','ENDED','PROCESSED','PROCESSING_FAILED');
   EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `CREATE TABLE IF NOT EXISTS "broadcast_lectures" (
     "id" uuid NOT NULL DEFAULT gen_random_uuid(),
     "title" character varying NOT NULL,
     "institute_id" uuid NOT NULL,
     "teacher_id" uuid NOT NULL,
     "stream_key" character varying NOT NULL,
     "status" "broadcast_lectures_status_enum" NOT NULL DEFAULT 'SCHEDULED',
     "scheduled_at" TIMESTAMP WITH TIME ZONE,
     "started_at" TIMESTAMP WITH TIME ZONE,
     "ended_at" TIMESTAMP WITH TIME ZONE,
     "recording_r2_path" character varying,
     "thumbnail_r2_path" character varying,
     "recording_size_gb" double precision,
     "duration_seconds" integer,
     "qualities" text[] NOT NULL DEFAULT '{360p,480p,720p,1080p}',
     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
     "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
     CONSTRAINT "PK_broadcast_lectures" PRIMARY KEY ("id"),
     CONSTRAINT "UQ_broadcast_lectures_stream_key" UNIQUE ("stream_key")
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_broadcast_lectures_institute" ON "broadcast_lectures" ("institute_id")`,
  `CREATE INDEX IF NOT EXISTS "IDX_broadcast_lectures_status" ON "broadcast_lectures" ("status")`,
  `CREATE TABLE IF NOT EXISTS "broadcast_sessions" (
     "id" uuid NOT NULL DEFAULT gen_random_uuid(),
     "lecture_id" uuid NOT NULL,
     "student_id" uuid NOT NULL,
     "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
     "left_at" TIMESTAMP WITH TIME ZONE,
     "watch_duration_seconds" integer,
     "quality_used" character varying,
     CONSTRAINT "PK_broadcast_sessions" PRIMARY KEY ("id"),
     CONSTRAINT "FK_broadcast_sessions_lecture" FOREIGN KEY ("lecture_id")
       REFERENCES "broadcast_lectures"("id") ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_broadcast_sessions_lecture" ON "broadcast_sessions" ("lecture_id")`,
  `CREATE TABLE IF NOT EXISTS "broadcast_chat_messages" (
     "id" uuid NOT NULL DEFAULT gen_random_uuid(),
     "lecture_id" uuid NOT NULL,
     "user_id" uuid NOT NULL,
     "text" character varying(500) NOT NULL,
     "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
     CONSTRAINT "PK_broadcast_chat_messages" PRIMARY KEY ("id"),
     CONSTRAINT "FK_broadcast_chat_lecture" FOREIGN KEY ("lecture_id")
       REFERENCES "broadcast_lectures"("id") ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "IDX_broadcast_chat_lecture" ON "broadcast_chat_messages" ("lecture_id")`,
];

(async () => {
  await client.connect();
  for (const stmt of SQL) await client.query(stmt);
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name LIKE 'broadcast_%' ORDER BY table_name`,
  );
  console.log('broadcast tables present:', rows.map((r) => r.table_name).join(', '));
  await client.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
