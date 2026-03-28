import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchIdToQuestions1700000000008 implements MigrationInterface {
  name = 'AddBatchIdToQuestions1700000000008';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE questions
        ADD COLUMN IF NOT EXISTS batch_id UUID NULL REFERENCES batches(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_questions_batch_id ON questions(batch_id)
      WHERE batch_id IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_questions_batch_id`);
    await queryRunner.query(`ALTER TABLE questions DROP COLUMN IF EXISTS batch_id`);
  }
}
