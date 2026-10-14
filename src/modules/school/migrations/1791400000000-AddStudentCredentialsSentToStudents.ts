import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks the STUDENT's own login credentials separately from
 * credentials_sent_at/credentials_sent_count (1790700000000), which already
 * tracks the PARENT's portal login being sent. Keeping these two distinct:
 * an admin sending one must not make the "already sent, skip?" bulk-action
 * logic think the other was also sent.
 */
export class AddStudentCredentialsSentToStudents1791400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS student_credentials_sent_at TIMESTAMPTZ NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS student_credentials_sent_count INTEGER NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE students DROP COLUMN IF EXISTS student_credentials_sent_count`);
    await queryRunner.query(`ALTER TABLE students DROP COLUMN IF EXISTS student_credentials_sent_at`);
  }
}
