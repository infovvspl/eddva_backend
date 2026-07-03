import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenVersionUpdatedAt1783000000002 implements MigrationInterface {
  name = 'AddTokenVersionUpdatedAt1783000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "token_version_updated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "token_version_updated_at"`,
    );
  }
}
