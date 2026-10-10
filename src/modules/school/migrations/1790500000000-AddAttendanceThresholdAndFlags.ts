import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configurable minimum-attendance-percentage thresholds (institute default +
 * per-teacher / per-student overrides), plus a generic `is_flag` marker on
 * notifications so any role's flagged alerts (e.g. low attendance) can be
 * surfaced distinctly in the Notification Center.
 */
export class AddAttendanceThresholdAndFlags1790500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE institutes
      ADD COLUMN IF NOT EXISTS min_attendance_percentage NUMERIC(5,2) NOT NULL DEFAULT 80;
    `);

    await queryRunner.query(`
      ALTER TABLE teachers
      ADD COLUMN IF NOT EXISTS min_attendance_percentage NUMERIC(5,2);
    `);

    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS min_attendance_percentage NUMERIC(5,2);
    `);

    await queryRunner.query(`
      ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS is_flag BOOLEAN NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_is_flag ON notifications(is_flag) WHERE is_flag = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notifications_is_flag`);
    await queryRunner.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS is_flag`);
    await queryRunner.query(`ALTER TABLE students DROP COLUMN IF EXISTS min_attendance_percentage`);
    await queryRunner.query(`ALTER TABLE teachers DROP COLUMN IF EXISTS min_attendance_percentage`);
    await queryRunner.query(`ALTER TABLE institutes DROP COLUMN IF EXISTS min_attendance_percentage`);
  }
}
