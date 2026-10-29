import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnabledLanguagesToTenants1793300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
      ADD COLUMN IF NOT EXISTS enabled_languages jsonb DEFAULT '["en","hi","or"]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE tenants SET enabled_languages = '["en","hi","or"]'::jsonb WHERE enabled_languages IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS enabled_languages`);
  }
}
