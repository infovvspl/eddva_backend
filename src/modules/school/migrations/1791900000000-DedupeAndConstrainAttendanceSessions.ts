import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * attendance_sessions has no DB-level uniqueness today -- the only collision
 * guard is an application-level SELECT in markSession()/checkSession(), which
 * degenerates to a subject-id wildcard whenever subjectId is omitted (see the
 * service-layer fix in the same change). That gap already produced real
 * duplicate rows in production (double-clicks / retries within seconds of
 * each other, same teacher, identical roster) -- this migration removes those
 * before adding the constraint that would otherwise refuse to create.
 *
 * Keeps the most recently created session per
 * (tenant_id, class_id, section_id, date, period, subject_id) slot and
 * removes the older duplicates' attendance_records and session row, then adds
 * a NULLS-NOT-DISTINCT unique index so two NULL-subject sessions for the same
 * slot collide with each other but never with a subject-specific one.
 */
export class DedupeAndConstrainAttendanceSessions1791900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(`SELECT to_regclass('public.attendance_sessions') AS t`);
    if (!exists?.[0]?.t) return;

    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY tenant_id, class_id, section_id, date, period, subject_id
                 ORDER BY created_at DESC
               ) AS rn
        FROM attendance_sessions
      ), stale AS (
        SELECT id FROM ranked WHERE rn > 1
      ), purge_records AS (
        DELETE FROM attendance_records WHERE session_id::text IN (SELECT id::text FROM stale)
      )
      DELETE FROM attendance_sessions WHERE id IN (SELECT id FROM stale)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_sessions_slot
      ON attendance_sessions (tenant_id, class_id, section_id, date, period, subject_id)
      NULLS NOT DISTINCT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_sessions_slot`);
    // The removed duplicate rows are not restorable.
  }
}
