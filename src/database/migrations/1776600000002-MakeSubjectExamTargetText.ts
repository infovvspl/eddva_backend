import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeSubjectExamTargetText1776600000002 implements MigrationInterface {
  name = 'MakeSubjectExamTargetText1776600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subjects"
      ALTER COLUMN "exam_target" TYPE character varying(120)
      USING "exam_target"::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subjects"
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

