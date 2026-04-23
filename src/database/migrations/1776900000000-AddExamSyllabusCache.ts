import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExamSyllabusCache1776900000000 implements MigrationInterface {
  name = 'AddExamSyllabusCache1776900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "exam_syllabus_cache" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        "tenant_id" uuid NOT NULL,
        "exam_target" text NOT NULL,
        "exam_year" text NOT NULL,
        "payload" jsonb NOT NULL,
        "source" text NOT NULL DEFAULT 'ai',
        CONSTRAINT "PK_exam_syllabus_cache_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_exam_syllabus_cache_tenant_exam_year"
      ON "exam_syllabus_cache" ("tenant_id", "exam_target", "exam_year")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_exam_syllabus_cache_tenant_exam_year"`);
    await queryRunner.query(`DROP TABLE "exam_syllabus_cache"`);
  }
}
