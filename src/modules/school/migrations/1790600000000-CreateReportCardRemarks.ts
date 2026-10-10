import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the free-text remark shown on a student's report card. Teacher
 * remarks always take priority; `ai_remark` is a generated fallback used only
 * when no teacher remark has been entered, and `remark_source` tells the UI
 * which one is currently in effect so admins can see an "AI generated" flag.
 */
export class CreateReportCardRemarks1790600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_card_remarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NOT NULL,
        student_id UUID NOT NULL,
        academic_year VARCHAR NOT NULL,
        class_name VARCHAR,
        teacher_remark TEXT,
        ai_remark TEXT,
        remark_source VARCHAR NOT NULL DEFAULT 'AI',
        ai_generated_at TIMESTAMPTZ,
        updated_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (student_id, academic_year)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_report_card_remarks_institute ON report_card_remarks(institute_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS report_card_remarks`);
  }
}
