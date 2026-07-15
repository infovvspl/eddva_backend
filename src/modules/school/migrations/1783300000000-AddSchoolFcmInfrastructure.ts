import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolFcmInfrastructure1783300000000 implements MigrationInterface {
  name = 'AddSchoolFcmInfrastructure1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add notification_enabled master-switch to students table
    await queryRunner.query(
      `ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "notification_enabled" boolean NOT NULL DEFAULT true`,
    );

    // 2. Multi-device token registry
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "school_device_tokens" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "student_id"     UUID NOT NULL,
        "fcm_token"      CHARACTER VARYING NOT NULL,
        "platform"       CHARACTER VARYING NOT NULL DEFAULT 'web',
        "device_info"    CHARACTER VARYING,
        "last_active_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_school_device_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_school_device_tokens_student"
          FOREIGN KEY ("student_id") REFERENCES "students"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "UQ_school_device_tokens_student_token"
          UNIQUE ("student_id", "fcm_token")
      )
    `);

    // 3. Notification dedup / audit log
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "school_notification_log" (
        "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
        "student_id"        UUID NOT NULL,
        "notification_type" CHARACTER VARYING NOT NULL,
        "reference_id"      CHARACTER VARYING,
        "sent_at"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "status"            CHARACTER VARYING NOT NULL,
        "fcm_message_id"    CHARACTER VARYING,
        "failure_reason"    TEXT,
        CONSTRAINT "PK_school_notification_log" PRIMARY KEY ("id"),
        CONSTRAINT "FK_school_notification_log_student"
          FOREIGN KEY ("student_id") REFERENCES "students"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // Index for the common dedup look-up: student + type + reference + date
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_school_notif_log_dedup"
        ON "school_notification_log" ("student_id", "notification_type", "reference_id", "sent_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_school_notif_log_dedup"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "school_notification_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "school_device_tokens"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "notification_enabled"`);
  }
}
