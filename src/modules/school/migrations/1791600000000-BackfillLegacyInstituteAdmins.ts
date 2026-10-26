import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores access for institute admins that existed before admin permissions.
 *
 * AddAdminPermissionsToUsers made only the earliest user whose role is exactly
 * 'INSTITUTE_ADMIN' the primary admin of each institute. Everyone else holding
 * the role (a second admin, or an admin who also teaches, role
 * 'INSTITUTE_ADMIN,TEACHER') was left non-primary with no permissions, so
 * AdminModuleGuard turned every admin module into a 403 for them — including
 * GET /school/teachers/:id and /school/academic/classes, which the teacher
 * pages of an admin who teaches load on start.
 *
 * Accounts made through the new flow are never touched: the sub-admin flow
 * always stores at least one module, so admin_permissions IS NULL on a
 * non-primary admin only happens for an admin from before the feature.
 *
 * 1. An institute with no primary admin gets its earliest admin as primary.
 * 2. Every other such admin gets every module (the access they had before),
 *    but not the primary admin's right to manage other admins.
 */
const ALL_MODULES = [
  'students',
  'teachers',
  'academics',
  'subjects',
  'competitive_exam_prep',
  'syllabus_planner',
  'syllabus_tracker',
  'attendance',
  'timetable',
  'academic_calendar',
  'notices',
  'communications',
  'erp',
  'user_management',
  'document_generator',
  'audit_logs',
  'complaints',
];

const IS_INSTITUTE_ADMIN = `'INSTITUTE_ADMIN' = ANY(string_to_array(replace(upper(COALESCE(role, '')), ' ', ''), ','))`;

export class BackfillLegacyInstituteAdmins1791600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users u
      SET is_primary_admin = TRUE
      FROM (
        SELECT DISTINCT ON (institute_id) id
        FROM users
        WHERE ${IS_INSTITUTE_ADMIN}
          AND institute_id IS NOT NULL
          AND admin_permissions IS NULL
          AND institute_id NOT IN (
            SELECT institute_id FROM users
            WHERE is_primary_admin = TRUE AND institute_id IS NOT NULL
          )
        ORDER BY institute_id, created_at ASC
      ) first_admin
      WHERE u.id = first_admin.id;
    `);

    await queryRunner.query(
      `UPDATE users
       SET admin_permissions = $1::jsonb
       WHERE ${IS_INSTITUTE_ADMIN}
         AND is_primary_admin = FALSE
         AND admin_permissions IS NULL`,
      [JSON.stringify(ALL_MODULES)],
    );
  }

  public async down(): Promise<void> {
    // A data backfill: the rows it changed cannot be told apart afterwards,
    // and putting them back would lock those admins out again.
  }
}
