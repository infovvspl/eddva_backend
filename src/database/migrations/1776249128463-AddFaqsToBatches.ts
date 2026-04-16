import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFaqsToBatches1776249128463 implements MigrationInterface {
  name = 'AddFaqsToBatches1776249128463';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "faqs" jsonb DEFAULT '[]'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "batches" DROP COLUMN IF EXISTS "faqs"`);
  }
}
