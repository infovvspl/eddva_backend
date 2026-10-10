import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assignment-specific groups. Groups belong to one assignment and are never a
 * permanent property of a student, so the same student can sit in different
 * groups for different assignments.
 *
 * Group submissions are stored as ONE assignment_submissions row per group
 * (group_id set); student_id records who last submitted on behalf of the group.
 */
export class CreateAssignmentGroups1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignments
        ADD COLUMN IF NOT EXISTS target_type VARCHAR(16) NOT NULL DEFAULT 'individual',
        ADD COLUMN IF NOT EXISTS group_strategy VARCHAR(16),
        ADD COLUMN IF NOT EXISTS group_size INT,
        ADD COLUMN IF NOT EXISTS max_marks NUMERIC NOT NULL DEFAULT 100;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL,
        group_name VARCHAR(120) NOT NULL,
        group_number INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_assignment_group_number UNIQUE (assignment_id, group_number)
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_group_members (
        group_id UUID NOT NULL,
        assignment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        PRIMARY KEY (group_id, student_id),
        -- a student can be in only one group per assignment
        CONSTRAINT uq_assignment_group_member UNIQUE (assignment_id, student_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_assignment_group_members_student
      ON assignment_group_members (student_id);
    `);
    await queryRunner.query(`
      ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS group_id UUID;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_submission_group
      ON assignment_submissions (assignment_id, group_id)
      WHERE group_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_assignment_submission_group`);
    await queryRunner.query(`ALTER TABLE assignment_submissions DROP COLUMN IF EXISTS group_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_group_members`);
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_groups`);
    await queryRunner.query(`
      ALTER TABLE assignments
        DROP COLUMN IF EXISTS group_size,
        DROP COLUMN IF EXISTS max_marks,
        DROP COLUMN IF EXISTS group_strategy,
        DROP COLUMN IF EXISTS target_type;
    `);
  }
}
