import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admins have no profile table of their own (they're plain `users` rows), so
 * birthday features need a dob column directly on users to cover them.
 */
export class AddDobToUsers1793000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS dob`);
  }
}
