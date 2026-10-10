import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Student pool: the exact students an assignment was sent to. Lets one
 * assignment span several sections/classes or a hand-picked subset.
 *
 * Existing assignments are intentionally NOT backfilled: an assignment with no
 * rows here keeps the legacy behaviour (everyone in its class/section), so
 * students who join a section later still see older assignments.
 */
export class CreateAssignmentStudents1790800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_students (
        assignment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (assignment_id, student_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_assignment_students_student
      ON assignment_students (student_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_students`);
  }
}
