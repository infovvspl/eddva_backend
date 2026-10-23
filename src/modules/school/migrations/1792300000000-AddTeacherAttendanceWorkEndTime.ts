import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `work_end_time` alongside the existing `work_start_time` (see
 * 1792200000000-AddTeacherAttendanceCheckIn). Both default to '09:00'/'16:00'
 * for every row — new and existing — so every institute starts with the
 * standard 9 AM-4 PM school day instead of requiring each admin to configure
 * it before self check-in becomes meaningful.
 */
export class AddTeacherAttendanceWorkEndTime1792300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE institutes
        ADD COLUMN IF NOT EXISTS work_end_time character varying(5)
    `);
    await queryRunner.query(`
      UPDATE institutes SET work_start_time = '09:00' WHERE work_start_time IS NULL
    `);
    await queryRunner.query(`
      UPDATE institutes SET work_end_time = '16:00' WHERE work_end_time IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE institutes
        ALTER COLUMN work_start_time SET DEFAULT '09:00',
        ALTER COLUMN work_end_time SET DEFAULT '16:00'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE institutes
        ALTER COLUMN work_start_time DROP DEFAULT,
        DROP COLUMN IF EXISTS work_end_time
    `);
  }
}
