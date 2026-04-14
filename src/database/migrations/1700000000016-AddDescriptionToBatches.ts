import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDescriptionToBatches1700000000016 implements MigrationInterface {
  name = 'AddDescriptionToBatches1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batches"
      ADD COLUMN IF NOT EXISTS "description" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "batches" DROP COLUMN IF EXISTS "description"`);
  }
}
