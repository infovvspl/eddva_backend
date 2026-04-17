import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantOnboarding1700000000019 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS city                TEXT,
        ADD COLUMN IF NOT EXISTS state               TEXT,
        ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE tenants
        DROP COLUMN IF EXISTS city,
        DROP COLUMN IF EXISTS state,
        DROP COLUMN IF EXISTS onboarding_complete;
    `);
  }
}
