import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsPaidToBatches1700000000015 implements MigrationInterface {
  name = 'AddIsPaidToBatches1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add is_paid column (defaults to false — existing batches are treated as free)
    await queryRunner.query(`
      ALTER TABLE "batches"
      ADD COLUMN IF NOT EXISTS "is_paid" boolean NOT NULL DEFAULT false
    `);

    // Add platform_fee_percent column (defaults to 20%)
    await queryRunner.query(`
      ALTER TABLE "batches"
      ADD COLUMN IF NOT EXISTS "platform_fee_percent" numeric(5,2) NOT NULL DEFAULT 20
    `);

    // Back-fill: any batch that already has a fee_amount set becomes a paid batch
    await queryRunner.query(`
      UPDATE "batches"
      SET "is_paid" = true
      WHERE "fee_amount" IS NOT NULL AND "fee_amount" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "batches" DROP COLUMN IF EXISTS "platform_fee_percent"`);
    await queryRunner.query(`ALTER TABLE "batches" DROP COLUMN IF EXISTS "is_paid"`);
  }
}
