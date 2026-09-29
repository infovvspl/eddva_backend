import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * createSyllabusPlan used to check-then-act: SELECT for an existing plan in this
 * institute/class/section/subject scope, then UPDATE if found or INSERT if not.
 * Two concurrent requests for the same scope (a double-click submit, or two admins
 * saving the same class at once) could both pass the SELECT before either INSERT
 * committed, producing two plans for what should be one scope.
 *
 * This unique index backs an INSERT ... ON CONFLICT DO UPDATE in the service,
 * making the check-and-act atomic. COALESCE(section_id::text, '') is required
 * because NULL never equals NULL in a unique constraint — the same trick used in
 * PreventDuplicateCurriculum for subjects/chapters scope columns.
 *
 * Creation is skipped, with a warning, if duplicates already exist from the old
 * race condition — an index that cannot be built must not block an otherwise good
 * deploy. Merge them first, then re-run.
 */
export class AddSyllabusPlanScopeUniqueIndex1790100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dupes = await queryRunner.query(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM syllabus_plans
        GROUP BY institute_id, class_id, COALESCE(section_id::text, ''), subject_id
        HAVING count(*) > 1
      ) d
    `);
    if (Number(dupes[0]?.n || 0) > 0) {
      console.warn(
        `[AddSyllabusPlanScopeUniqueIndex] ${dupes[0].n} duplicate syllabus_plans scope group(s) ` +
        `found — skipping the unique index. Merge the duplicate plans, then re-run this migration.`,
      );
    } else {
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_syllabus_plans_scope
        ON syllabus_plans (institute_id, class_id, COALESCE(section_id::text, ''), subject_id)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ux_syllabus_plans_scope`);
  }
}
