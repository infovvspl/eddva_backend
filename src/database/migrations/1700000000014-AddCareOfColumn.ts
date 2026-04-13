import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCareOfColumn1700000000014 implements MigrationInterface {
  name = 'AddCareOfColumn1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // If fathers_name exists and care_of doesn't, rename it (migration 010 may not have run)
    const hasFathersName = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'students' AND column_name = 'fathers_name'
    `);

    const hasCareOf = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'students' AND column_name = 'care_of'
    `);

    if (hasFathersName.length > 0 && hasCareOf.length === 0) {
      await queryRunner.query(`ALTER TABLE "students" RENAME COLUMN "fathers_name" TO "care_of"`);
    } else if (hasCareOf.length === 0) {
      await queryRunner.query(`ALTER TABLE "students" ADD COLUMN "care_of" character varying`);
    }
    // If care_of already exists, do nothing
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "care_of"`);
  }
}