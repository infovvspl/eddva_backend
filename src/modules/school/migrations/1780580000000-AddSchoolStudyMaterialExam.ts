import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolStudyMaterialExam1780580000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE study_materials_exam_enum ADD VALUE IF NOT EXISTS 'school'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL cannot safely remove enum values while rows may still use them.
  }
}
