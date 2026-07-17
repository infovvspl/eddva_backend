import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReKeySchoolDeviceTokens1783400000000 implements MigrationInterface {
  name = 'ReKeySchoolDeviceTokens1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Re-key school_device_tokens ────────────────────────────────────────

    // Drop constraints from the student-keyed design
    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP CONSTRAINT IF EXISTS "FK_school_device_tokens_student"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP CONSTRAINT IF EXISTS "UQ_school_device_tokens_student_token"
    `);

    // Add nullable user_id column
    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD COLUMN IF NOT EXISTS "user_id" UUID
    `);

    // Backfill user_id using the students user_id mapping
    await queryRunner.query(`
      UPDATE "school_device_tokens" dt
      SET "user_id" = s.user_id
      FROM "students" s
      WHERE dt.student_id = s.id
    `);

    // Delete orphaned rows (dev safety)
    await queryRunner.query(`
      DELETE FROM "school_device_tokens" WHERE "user_id" IS NULL
    `);

    // Enforce NOT NULL on user_id and drop student_id
    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ALTER COLUMN "user_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP COLUMN IF EXISTS "student_id"
    `);

    // Establish new FK to users and new composite UNIQUE key
    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD CONSTRAINT "FK_school_device_tokens_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD CONSTRAINT "UQ_school_device_tokens_user_token"
        UNIQUE ("user_id", "fcm_token")
    `);

    // ── 2. Re-key school_notification_log ─────────────────────────────────────

    // Drop constraint from the student-keyed design
    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      DROP CONSTRAINT IF EXISTS "FK_school_notification_log_student"
    `);

    // Add nullable user_id column
    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ADD COLUMN IF NOT EXISTS "user_id" UUID
    `);

    // Backfill user_id using the students user_id mapping
    await queryRunner.query(`
      UPDATE "school_notification_log" nl
      SET "user_id" = s.user_id
      FROM "students" s
      WHERE nl.student_id = s.id
    `);

    // Delete orphaned rows
    await queryRunner.query(`
      DELETE FROM "school_notification_log" WHERE "user_id" IS NULL
    `);

    // Enforce NOT NULL on user_id and drop student_id
    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ALTER COLUMN "user_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      DROP COLUMN IF EXISTS "student_id"
    `);

    // Establish new FK to users
    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ADD CONSTRAINT "FK_school_notification_log_user"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Revert school_notification_log ─────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      DROP CONSTRAINT IF EXISTS "FK_school_notification_log_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ADD COLUMN IF NOT EXISTS "student_id" UUID
    `);

    await queryRunner.query(`
      UPDATE "school_notification_log" nl
      SET "student_id" = s.id
      FROM "students" s
      WHERE nl.user_id = s.user_id
    `);

    await queryRunner.query(`
      DELETE FROM "school_notification_log" WHERE "student_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ALTER COLUMN "student_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      DROP COLUMN IF EXISTS "user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_notification_log"
      ADD CONSTRAINT "FK_school_notification_log_student"
        FOREIGN KEY ("student_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // ── 2. Revert school_device_tokens ────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP CONSTRAINT IF EXISTS "UQ_school_device_tokens_user_token"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP CONSTRAINT IF EXISTS "FK_school_device_tokens_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD COLUMN IF NOT EXISTS "student_id" UUID
    `);

    await queryRunner.query(`
      UPDATE "school_device_tokens" dt
      SET "student_id" = s.id
      FROM "students" s
      WHERE dt.user_id = s.user_id
    `);

    await queryRunner.query(`
      DELETE FROM "school_device_tokens" WHERE "student_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ALTER COLUMN "student_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      DROP COLUMN IF EXISTS "user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD CONSTRAINT "FK_school_device_tokens_student"
        FOREIGN KEY ("student_id") REFERENCES "students"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "school_device_tokens"
      ADD CONSTRAINT "UQ_school_device_tokens_student_token"
        UNIQUE ("student_id", "fcm_token")
    `);
  }
}
