import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeStudentAcademicFieldsNullable1700000000011 implements MigrationInterface {
  name = 'MakeStudentAcademicFieldsNullable1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "exam_target" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "class" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "exam_year" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "exam_year" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "class" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "exam_target" SET NOT NULL`);
  }
}
