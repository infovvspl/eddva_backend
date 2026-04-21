import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeBatchAcademicFieldsText1776500000005 implements MigrationInterface {
  name = 'MakeBatchAcademicFieldsText1776500000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batches"
      ALTER COLUMN "exam_target" TYPE character varying(120)
      USING "exam_target"::text
    `);

    await queryRunner.query(`
      ALTER TABLE "batches"
      ALTER COLUMN "class" TYPE character varying(120)
      USING "class"::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batches"
      ALTER COLUMN "exam_target" TYPE exam_target_enum
      USING (
        CASE
          WHEN lower("exam_target") IN ('jee', 'neet', 'both') THEN lower("exam_target")::exam_target_enum
          ELSE 'both'::exam_target_enum
        END
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "batches"
      ALTER COLUMN "class" TYPE student_class_enum
      USING (
        CASE
          WHEN lower("class") IN ('8', '9', '10', '11', '12', 'dropper') THEN lower("class")::student_class_enum
          ELSE '11'::student_class_enum
        END
      )
    `);
  }
}

