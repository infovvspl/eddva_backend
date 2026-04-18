import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchIdToDoubts1776500000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE doubts
      ADD COLUMN IF NOT EXISTS batch_id UUID NULL,
      ADD CONSTRAINT fk_doubt_batch
        FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE doubts
      DROP CONSTRAINT IF EXISTS fk_doubt_batch,
      DROP COLUMN IF EXISTS batch_id
    `);
  }
}