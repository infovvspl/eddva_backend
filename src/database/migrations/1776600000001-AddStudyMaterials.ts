import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudyMaterials1776600000001 implements MigrationInterface {
  name = 'AddStudyMaterials1776600000001';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TYPE "study_material_exam_enum" AS ENUM('jee', 'neet');
    `);
    await runner.query(`
      CREATE TYPE "study_material_type_enum" AS ENUM('notes', 'pyq', 'formula_sheet', 'dpp');
    `);
    await runner.query(`
      CREATE TABLE "study_materials" (
        "id"            uuid               NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id"     character varying  NOT NULL,
        "exam"          "study_material_exam_enum"  NOT NULL,
        "type"          "study_material_type_enum"  NOT NULL,
        "title"         character varying  NOT NULL,
        "subject"       character varying,
        "chapter"       character varying,
        "description"   character varying,
        "s3_key"        character varying  NOT NULL,
        "file_size_kb"  integer,
        "total_pages"   integer,
        "preview_pages" integer            NOT NULL DEFAULT 2,
        "uploaded_by"   character varying  NOT NULL,
        "is_active"     boolean            NOT NULL DEFAULT true,
        "sort_order"    integer            NOT NULL DEFAULT 0,
        "created_at"    TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ        NOT NULL DEFAULT now(),
        CONSTRAINT "PK_study_materials" PRIMARY KEY ("id")
      );
    `);
    await runner.query(`CREATE INDEX "IDX_sm_exam_type"      ON "study_materials" ("exam", "type");`);
    await runner.query(`CREATE INDEX "IDX_sm_tenant_exam"    ON "study_materials" ("tenant_id", "exam");`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX "IDX_sm_tenant_exam";`);
    await runner.query(`DROP INDEX "IDX_sm_exam_type";`);
    await runner.query(`DROP TABLE "study_materials";`);
    await runner.query(`DROP TYPE "study_material_type_enum";`);
    await runner.query(`DROP TYPE "study_material_exam_enum";`);
  }
}
