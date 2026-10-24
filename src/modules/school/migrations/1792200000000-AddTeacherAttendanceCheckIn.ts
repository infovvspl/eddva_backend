import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds self-service check-in to the existing manual `teacher_attendance` MVP
 * (see 1792000000000-AddTeacherAttendance) instead of a separate table, per
 * that migration's own note that biometric/geofence attendance "can coexist
 * with it, or be migrated into it". `method` distinguishes how a row was
 * created; existing (and future admin-marked) rows default to 'MANUAL'.
 * Campus lat/lng/radius + work-start-time live on `institutes` since
 * geofencing needs a single reference point per institute, not per row.
 */
export class AddTeacherAttendanceCheckIn1792200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_attendance
        ADD COLUMN IF NOT EXISTS method character varying NOT NULL DEFAULT 'MANUAL',
        ADD COLUMN IF NOT EXISTS check_in_time TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS latitude numeric(10,7),
        ADD COLUMN IF NOT EXISTS longitude numeric(10,7),
        ADD COLUMN IF NOT EXISTS device_id character varying
    `);

    await queryRunner.query(`
      ALTER TABLE institutes
        ADD COLUMN IF NOT EXISTS campus_latitude numeric(10,7),
        ADD COLUMN IF NOT EXISTS campus_longitude numeric(10,7),
        ADD COLUMN IF NOT EXISTS campus_radius_meters integer,
        ADD COLUMN IF NOT EXISTS work_start_time character varying(5),
        ADD COLUMN IF NOT EXISTS late_threshold_minutes integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_attendance
        DROP COLUMN IF EXISTS method,
        DROP COLUMN IF EXISTS check_in_time,
        DROP COLUMN IF EXISTS check_out_time,
        DROP COLUMN IF EXISTS latitude,
        DROP COLUMN IF EXISTS longitude,
        DROP COLUMN IF EXISTS device_id
    `);
    await queryRunner.query(`
      ALTER TABLE institutes
        DROP COLUMN IF EXISTS campus_latitude,
        DROP COLUMN IF EXISTS campus_longitude,
        DROP COLUMN IF EXISTS campus_radius_meters,
        DROP COLUMN IF EXISTS work_start_time,
        DROP COLUMN IF EXISTS late_threshold_minutes
    `);
  }
}
