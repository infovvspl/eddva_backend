import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual teacher-attendance MVP: admin marks each teacher present/absent/
 * late/leave for a day, and the admin dashboard shows a "who's in today"
 * list with marked-at times. Deliberately separate from the student
 * attendance tables (attendances/attendance_sessions/attendance_records) --
 * "teacher is the attendee" doesn't map cleanly onto a schema built around
 * "student is the attendee, teacher is who marked it". This table is the
 * manual stand-in for the eventual biometric-backed staff_attendance_daily
 * (see the staff-biometric-attendance plan) and can coexist with it, or be
 * migrated into it, once that lands.
 */
export class AddTeacherAttendance1792000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS teacher_attendance (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        institute_id uuid NOT NULL,
        teacher_user_id uuid NOT NULL,
        date character varying NOT NULL,
        status character varying NOT NULL DEFAULT 'present',
        remarks character varying,
        marked_by uuid,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_teacher_attendance" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_attendance_day
      ON teacher_attendance (institute_id, teacher_user_id, date)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_teacher_attendance_institute_date
      ON teacher_attendance (institute_id, date)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS teacher_attendance`);
  }
}
