import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add missing columns to attendance_sessions and attendance_records that
 * the service layer expects: tenant_id, class_id, marked_by, period.
 */
export class AddMissingAttendanceColumns1783100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // attendance_sessions: add tenant_id (institute scope)
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS tenant_id character varying;
    `);

    // attendance_sessions: add class_id
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS class_id character varying;
    `);

    // attendance_sessions: add marked_by (user_id of who submitted)
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS marked_by character varying;
    `);

    // attendance_sessions: add period label
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD COLUMN IF NOT EXISTS period character varying;
    `);

    // attendance_records: add tenant_id
    await queryRunner.query(`
      ALTER TABLE attendance_records
      ADD COLUMN IF NOT EXISTS tenant_id character varying;
    `);

    // attendance_records: add remarks
    await queryRunner.query(`
      ALTER TABLE attendance_records
      ADD COLUMN IF NOT EXISTS remarks character varying;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS period`);
    await queryRunner.query(`ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS marked_by`);
    await queryRunner.query(`ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS class_id`);
    await queryRunner.query(`ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS tenant_id`);
    await queryRunner.query(`ALTER TABLE attendance_records DROP COLUMN IF EXISTS remarks`);
    await queryRunner.query(`ALTER TABLE attendance_records DROP COLUMN IF EXISTS tenant_id`);
  }
}
