import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks whether/when a parent's login credentials have been emailed for a
 * given student — needed so the bulk "send parent credentials" admin action
 * can show per-row status and default to skipping parents who already have
 * credentials, instead of silently re-sending (and re-randomizing their
 * password) every time the admin reruns the batch.
 */
export class AddCredentialsSentToStudents1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE students
      ADD COLUMN IF NOT EXISTS credentials_sent_count INTEGER NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE students DROP COLUMN IF EXISTS credentials_sent_count`);
    await queryRunner.query(`ALTER TABLE students DROP COLUMN IF EXISTS credentials_sent_at`);
  }
}
