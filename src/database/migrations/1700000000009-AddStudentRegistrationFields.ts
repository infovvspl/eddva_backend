import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentRegistrationFields1700000000009 implements MigrationInterface {
  name = 'AddStudentRegistrationFields1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "fathers_name" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "whatsapp_number" character varying`);
    await queryRunner.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "country" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "country"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "whatsapp_number"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "fathers_name"`);
  }
}
