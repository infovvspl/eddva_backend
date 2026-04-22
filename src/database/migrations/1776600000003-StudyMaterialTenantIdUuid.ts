import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * study_materials.tenant_id was created as varchar; tenants.id is uuid.
 * Joins (uuid = character varying) fail in PostgreSQL. Align column type.
 */
export class StudyMaterialTenantIdUuid1776600000003 implements MigrationInterface {
  name = 'StudyMaterialTenantIdUuid1776600000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "study_materials"
      ALTER COLUMN "tenant_id" TYPE uuid
      USING "tenant_id"::uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "study_materials"
      ALTER COLUMN "tenant_id" TYPE character varying
      USING "tenant_id"::text
    `);
  }
}
