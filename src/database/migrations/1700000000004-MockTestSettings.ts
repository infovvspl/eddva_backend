import { MigrationInterface, QueryRunner } from 'typeorm';

export class MockTestSettings1700000000004 implements MigrationInterface {
  name = 'MockTestSettings1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mock_tests
        ADD COLUMN IF NOT EXISTS shuffle_questions         BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS show_answers_after_submit BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS allow_reattempt           BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mock_tests
        DROP COLUMN IF EXISTS shuffle_questions,
        DROP COLUMN IF EXISTS show_answers_after_submit,
        DROP COLUMN IF EXISTS allow_reattempt
    `);
  }
}
