import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1781300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID NOT NULL DEFAULT uuid_generate_v4(),
        user_id character varying(255),
        user_name character varying(255),
        role character varying(50),
        module character varying(100) NOT NULL,
        action character varying(100) NOT NULL,
        description text,
        ip_address character varying(45),
        status character varying(20) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT PK_audit_logs PRIMARY KEY (id)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs`);
  }
}
