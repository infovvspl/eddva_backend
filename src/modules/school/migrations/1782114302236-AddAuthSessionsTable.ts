import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthSessionsTable1782114302236 implements MigrationInterface {
  name = 'AddAuthSessionsTable1782114302236';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "user_id" character varying NOT NULL,
        "device" character varying,
        "browser" character varying,
        "ip_address" character varying,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_active_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_sessions" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
  }
}
