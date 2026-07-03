import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenVersionToUsers1783000000001 implements MigrationInterface {
  name = 'AddTokenVersionToUsers1783000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "token_version" integer DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "token_version"`,
    );
  }
}
