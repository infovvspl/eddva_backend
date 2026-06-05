import { MigrationInterface, QueryRunner } from 'typeorm';

/** Align assignment_submissions with school assignment service (file_path, notes, marks). */
export class AlterAssignmentSubmissionsColumns1780550000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        ADD COLUMN IF NOT EXISTS file_path TEXT,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS marks DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    await queryRunner.query(`
      UPDATE assignment_submissions
      SET file_path = submission_url
      WHERE file_path IS NULL AND submission_url IS NOT NULL;
    `);
    await queryRunner.query(`
      UPDATE assignment_submissions
      SET marks = grade
      WHERE marks IS NULL AND grade IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignment_submissions
        DROP COLUMN IF EXISTS file_path,
        DROP COLUMN IF EXISTS notes,
        DROP COLUMN IF EXISTS marks;
    `);
  }
}
