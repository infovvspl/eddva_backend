import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a parent attach an actual signature image to their report-card
 * acknowledgement, alongside the existing "Mark as Checked" timestamp — see
 * school-report-card-remarks.service.ts presignParentSignature/saveParentSignature.
 */
export class AddParentSignatureToAcknowledgements1793300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE report_card_acknowledgements ADD COLUMN IF NOT EXISTS signature_url TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE report_card_acknowledgements DROP COLUMN IF EXISTS signature_url;
    `);
  }
}
