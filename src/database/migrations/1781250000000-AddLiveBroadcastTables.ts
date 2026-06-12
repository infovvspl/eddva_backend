import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Self-hosted RTMP → HLS live broadcast module tables.
 * Separate from the Agora/Bunny live-class tables.
 */
export class AddLiveBroadcastTables1781250000000 implements MigrationInterface {
  name = 'AddLiveBroadcastTables1781250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "broadcast_lectures_status_enum" AS ENUM
          ('SCHEDULED','LIVE','ENDED','PROCESSED','PROCESSING_FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "broadcast_lectures" (
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
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_lectures_institute" ON "broadcast_lectures" ("institute_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_lectures_status" ON "broadcast_lectures" ("status")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "broadcast_sessions" (
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
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_sessions_lecture" ON "broadcast_sessions" ("lecture_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "broadcast_chat_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "lecture_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "text" character varying(500) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_broadcast_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_broadcast_chat_lecture" FOREIGN KEY ("lecture_id")
          REFERENCES "broadcast_lectures"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_chat_lecture" ON "broadcast_chat_messages" ("lecture_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "broadcast_chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "broadcast_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "broadcast_lectures"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "broadcast_lectures_status_enum"`);
  }
}
