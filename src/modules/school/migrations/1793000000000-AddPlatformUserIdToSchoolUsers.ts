import { MigrationInterface, QueryRunner } from 'typeorm';

/** Links a school user to its identity in eddva_platform (see internal-platform-link.controller). */
export class AddPlatformUserIdToSchoolUsers1793000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_id VARCHAR`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_platform_user_id" ON users (platform_user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_platform_user_id"`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS platform_user_id`);
  }
}
