import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop legacy FK constraints to tenants(id) from attendance_sessions and attendance_records.
 * Multi-tenancy in these tables uses institute IDs in the school module, similar to assignments.
 */
export class DropAttendanceTenantFk1780550000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      DROP CONSTRAINT IF EXISTS "FK_a7f892c8d789419c94bfbbc4cf5";
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_records
      DROP CONSTRAINT IF EXISTS "FK_da9dd4e1e5a31c92c38a401ea59";
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Adding back legacy FK constraints if needed, but not recommended as it blocks valid institute IDs.
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD CONSTRAINT "FK_a7f892c8d789419c94bfbbc4cf5"
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_records
      ADD CONSTRAINT "FK_da9dd4e1e5a31c92c38a401ea59"
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    `);
  }
}
