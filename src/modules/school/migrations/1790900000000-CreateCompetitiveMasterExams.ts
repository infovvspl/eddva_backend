import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A real, managed list of competitive exams, replacing the hardcoded
 * jee_mains/jee_advanced/neet list that used to live only in frontend
 * constants. Super Admin can add any exam here (BITSAT, WBJEE, CUET, etc.)
 * — every screen that previously offered a fixed 3-item exam-target
 * dropdown now reads from this table instead.
 */
export class CreateCompetitiveMasterExams1790900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_master_exams (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        code character varying NOT NULL,
        name character varying NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_master_exams" PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cme_code ON competitive_master_exams (LOWER(TRIM(code)))
    `);

    // Seed the three exams that were previously hardcoded in the frontend.
    await queryRunner.query(`
      INSERT INTO competitive_master_exams (code, name)
      VALUES
        ('jee_mains', 'JEE Mains'),
        ('jee_advanced', 'JEE Advanced'),
        ('neet', 'NEET')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_master_exams`);
  }
}
