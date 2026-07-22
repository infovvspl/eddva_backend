import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeMaintenanceModeByVertical1783400000000 implements MigrationInterface {
  name = 'ScopeMaintenanceModeByVertical1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS coaching_maintenance_mode boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS school_maintenance_mode boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE platform_config SET coaching_maintenance_mode = COALESCE(maintenance_mode, false)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE platform_config DROP COLUMN IF EXISTS school_maintenance_mode`);
    await queryRunner.query(`ALTER TABLE platform_config DROP COLUMN IF EXISTS coaching_maintenance_mode`);
  }
}
