import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchIdToSubjects1700000000017 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE subjects
      ADD COLUMN IF NOT EXISTS batch_id UUID NULL REFERENCES batches(id) ON DELETE SET NULL
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS idx_subjects_batch_id ON subjects(batch_id)
      WHERE batch_id IS NOT NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS idx_subjects_batch_id`);
    await runner.query(`ALTER TABLE subjects DROP COLUMN IF EXISTS batch_id`);
  }
}
