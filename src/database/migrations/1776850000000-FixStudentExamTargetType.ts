import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixStudentExamTargetType1776850000000 implements MigrationInterface {
  name = 'FixStudentExamTargetType1776850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert students.exam_target from enum to varchar(120)
    await queryRunner.query(`
      ALTER TABLE "students"
      ALTER COLUMN "exam_target" TYPE character varying(120)
      USING "exam_target"::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Convert back to enum, mapping unknown values to 'both'
    await queryRunner.query(`
      ALTER TABLE "students"
      ALTER COLUMN "exam_target" TYPE exam_target_enum
      USING (
        CASE
          WHEN lower("exam_target") IN ('jee', 'neet', 'both') THEN lower("exam_target")::exam_target_enum
          ELSE 'both'::exam_target_enum
        END
      )
    `);
  }
}
