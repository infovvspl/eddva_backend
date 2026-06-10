import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCareerGuidanceTables1780560000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_interest_quiz_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL,
        institute_id UUID NOT NULL,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb,
        holland_code VARCHAR NOT NULL,
        scores JSONB NOT NULL DEFAULT '{}'::jsonb,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        can_retake_after TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_interest_quiz_student ON school_interest_quiz_results (student_id, completed_at)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_career_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL,
        institute_id UUID NOT NULL,
        report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_until TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_career_reports_student ON school_career_reports (student_id, generated_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS school_career_reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_interest_quiz_results`);
  }
}
