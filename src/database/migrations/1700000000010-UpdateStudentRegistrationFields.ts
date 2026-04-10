import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateStudentRegistrationFields1700000000010 implements MigrationInterface {
  name = 'UpdateStudentRegistrationFields1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename fathers_name → care_of
    await queryRunner.query(`ALTER TABLE "students" RENAME COLUMN "fathers_name" TO "care_of"`);
    // Rename whatsapp_number → alternate_phone_number
    await queryRunner.query(`ALTER TABLE "students" RENAME COLUMN "whatsapp_number" TO "alternate_phone_number"`);
    // Drop country (replaced by address + post_office + landmark + pin_code)
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "country"`);
    // Add new address fields
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "address" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "post_office" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "landmark" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "pin_code" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "pin_code"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "landmark"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "post_office"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "address"`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "country" character varying`);
    await queryRunner.query(`ALTER TABLE "students" RENAME COLUMN "alternate_phone_number" TO "whatsapp_number"`);
    await queryRunner.query(`ALTER TABLE "students" RENAME COLUMN "care_of" TO "fathers_name"`);
  }
}
