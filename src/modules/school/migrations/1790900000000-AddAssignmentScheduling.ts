import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assignment lifecycle + submission rules.
 *  - status: draft -> scheduled -> active (published). Existing rows are already 'active'.
 *  - start_at: when a scheduled assignment is released to students.
 *  - late_policy: 'allow' (submission is flagged late) or 'block' (closed after due date).
 *  - max_attempts: NULL = unlimited (the previous behaviour).
 *  - submissions track attempt_count and is_late.
 */
export class AddAssignmentScheduling1790900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignments
        ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS late_policy VARCHAR(8) NOT NULL DEFAULT 'allow',
        ADD COLUMN IF NOT EXISTS max_attempts INT;
    `);
    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_assignments_scheduled
      ON assignments (start_at) WHERE status = 'scheduled';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_assignments_scheduled`);
    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        DROP COLUMN IF EXISTS is_late,
        DROP COLUMN IF EXISTS attempt_count;
    `);
    await queryRunner.query(`
      ALTER TABLE assignments
        DROP COLUMN IF EXISTS max_attempts,
        DROP COLUMN IF EXISTS late_policy,
        DROP COLUMN IF EXISTS published_at,
        DROP COLUMN IF EXISTS start_at;
    `);
  }
}
