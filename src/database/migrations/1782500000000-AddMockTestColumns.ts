import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Formalises the columns added by the one-off add-mock-test-columns.mjs script.
 * Safe to re-run: all statements are idempotent (IF NOT EXISTS / exception handlers).
 */
export class AddMockTestColumns1782500000000 implements MigrationInterface {
  name = 'AddMockTestColumns1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types (no-op if they already exist)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE mock_test_type_enum AS ENUM (
          'full_mock','subject_test','chapter_test','topic_test',
          'subtopic_drill','speed_test','pyq','revision','diagnostic'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE mock_test_scope_enum AS ENUM ('batch','subject','chapter','topic');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Ensure all enum values exist (ADD VALUE is idempotent via IF NOT EXISTS)
    for (const val of ['subject_test','chapter_test','topic_test','subtopic_drill','speed_test','pyq','revision','diagnostic']) {
      await queryRunner.query(
        `DO $$ BEGIN ALTER TYPE mock_test_type_enum ADD VALUE IF NOT EXISTS '${val}'; EXCEPTION WHEN others THEN NULL; END $$`,
      );
    }

    // Add columns (IF NOT EXISTS — safe on already-patched tables)
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS type mock_test_type_enum NOT NULL DEFAULT 'topic_test'`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS scope mock_test_scope_enum NOT NULL DEFAULT 'batch'`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS batch_id uuid`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS subject_id uuid`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS chapter_id uuid`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS topic_id uuid`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS passing_marks integer`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS shuffle_questions boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS show_answers_after_submit boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS allow_reattempt boolean NOT NULL DEFAULT false`);

    // Indexes for the new scope columns
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mock_tests_scope ON mock_tests (scope, batch_id, subject_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mock_tests_tenant_type ON mock_tests (tenant_id, type, is_published)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mock_tests_tenant_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mock_tests_scope`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS allow_reattempt`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS show_answers_after_submit`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS shuffle_questions`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS is_published`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS passing_marks`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS topic_id`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS chapter_id`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS subject_id`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS batch_id`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS scope`);
    await queryRunner.query(`ALTER TABLE mock_tests DROP COLUMN IF EXISTS type`);
    await queryRunner.query(`DROP TYPE IF EXISTS mock_test_scope_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS mock_test_type_enum`);
  }
}
