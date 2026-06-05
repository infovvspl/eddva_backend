import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * School multi-tenancy uses institutes.id; assignments.tenant_id stores institute scope
 * (same as study_materials). The legacy FK to tenants(id) rejects valid institute IDs.
 */
export class DropAssignmentsTenantFk1780550000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignments
      DROP CONSTRAINT IF EXISTS "FK_bba4db2b1a9a33de6df91266ec0";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assignments
      ADD CONSTRAINT "FK_bba4db2b1a9a33de6df91266ec0"
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    `);
  }
}
