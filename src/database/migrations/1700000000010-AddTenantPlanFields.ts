import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantPlanFields1700000000010 implements MigrationInterface {
  name = 'AddTenantPlanFields1700000000010';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "plan_expires_at"   TIMESTAMPTZ  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "is_suspended"      BOOLEAN      NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "suspension_reason" VARCHAR      DEFAULT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        DROP COLUMN IF EXISTS "plan_expires_at",
        DROP COLUMN IF EXISTS "is_suspended",
        DROP COLUMN IF EXISTS "suspension_reason"
    `);
  }
}
