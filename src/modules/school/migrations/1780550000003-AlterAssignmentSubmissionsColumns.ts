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
      DO $$ 
      BEGIN 
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assignment_submissions' AND column_name='submission_url') THEN 
          UPDATE assignment_submissions SET file_path = submission_url WHERE file_path IS NULL AND submission_url IS NOT NULL; 
        END IF; 
      END $$;
    `);
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='assignment_submissions' AND column_name='grade') THEN 
          UPDATE assignment_submissions SET marks = grade WHERE marks IS NULL AND grade IS NOT NULL; 
        END IF; 
      END $$;
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
