import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoachingNotificationLog1782296504058 implements MigrationInterface {
    name = 'AddCoachingNotificationLog1782296504058';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add new columns to students table
        await queryRunner.query(`ALTER TABLE "students" ADD "fcm_token" character varying`);
        await queryRunner.query(`ALTER TABLE "students" ADD "language_preference" character varying NOT NULL DEFAULT 'en'`);
        await queryRunner.query(`ALTER TABLE "students" ADD "timezone" character varying NOT NULL DEFAULT 'Asia/Kolkata'`);
        await queryRunner.query(`ALTER TABLE "students" ADD "notification_enabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "students" ADD "quiet_hours_override" boolean NOT NULL DEFAULT false`);

        // Create coaching_notification_log table
        await queryRunner.query(`
            CREATE TABLE "coaching_notification_log" (
                "id"                UUID NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
                "deleted_at"        TIMESTAMPTZ,
                "student_id"        UUID NOT NULL,
                "notification_type" VARCHAR NOT NULL,
                "sent_at"           TIMESTAMPTZ NOT NULL,
                "status"            VARCHAR NOT NULL,
                "fcm_message_id"    VARCHAR,
                CONSTRAINT "PK_coaching_notification_log" PRIMARY KEY ("id")
            )
        `);

        // Add foreign key constraint
        await queryRunner.query(`
            ALTER TABLE "coaching_notification_log"
                ADD CONSTRAINT "FK_coaching_notification_log_student"
                FOREIGN KEY ("student_id") REFERENCES "students"("id")
                ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "coaching_notification_log" DROP CONSTRAINT IF EXISTS "FK_coaching_notification_log_student"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "coaching_notification_log"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "quiet_hours_override"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "notification_enabled"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "timezone"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "language_preference"`);
        await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "fcm_token"`);
    }
}
