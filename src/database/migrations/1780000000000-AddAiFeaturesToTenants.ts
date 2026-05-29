import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiFeaturesToTenants1780000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await queryRunner.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_features JSONB NOT NULL DEFAULT '[]'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS ai_features`);
    await queryRunner.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS ai_enabled`);
  }
}
