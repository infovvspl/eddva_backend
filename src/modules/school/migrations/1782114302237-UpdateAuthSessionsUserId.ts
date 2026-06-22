import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateAuthSessionsUserId1782114302237 implements MigrationInterface {
  name = 'UpdateAuthSessionsUserId1782114302237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_sessions
      ALTER COLUMN user_id TYPE uuid
      USING user_id::uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE auth_sessions
      ADD CONSTRAINT fk_auth_sessions_user
      FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth_sessions
      DROP CONSTRAINT fk_auth_sessions_user;
    `);

    await queryRunner.query(`
      ALTER TABLE auth_sessions
      ALTER COLUMN user_id TYPE character varying
      USING user_id::character varying;
    `);
  }
}
