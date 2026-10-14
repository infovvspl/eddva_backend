import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the publish → approve (→ reject) workflow to report_card_remarks, plus a
 * per-parent acknowledgement table (a student can have two parents who each
 * check it independently). `DEFAULT 'DRAFT'` intentionally backfills every
 * existing row to DRAFT (confirmed with the product owner: every report card
 * that already exists must go through publish+approve again, even ones
 * students/parents could already see) — a report card with no remarks row at
 * all is given the same DRAFT treatment at the service layer (see
 * school-report-card-remarks.service.ts), since remarks rows are optional and
 * plenty of report cards never had one.
 */
export class AddReportCardWorkflowStatus1791400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS published_by UUID;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS approved_by UUID;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS rejected_by UUID;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
      ALTER TABLE report_card_remarks ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_report_card_remarks_status ON report_card_remarks(status);
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_card_acknowledgements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institute_id UUID NOT NULL,
        student_id UUID NOT NULL,
        academic_year VARCHAR NOT NULL,
        parent_user_id UUID NOT NULL,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (student_id, academic_year, parent_user_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_report_card_ack_student_year ON report_card_acknowledgements(student_id, academic_year);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS report_card_acknowledgements`);
    await queryRunner.query(`
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS status;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS published_by;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS published_at;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS approved_by;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS approved_at;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS rejected_by;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS rejected_at;
      ALTER TABLE report_card_remarks DROP COLUMN IF EXISTS rejection_reason;
    `);
  }
}
