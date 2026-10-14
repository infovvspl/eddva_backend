import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Symmetric counterpart to `erp_enabled`: lets Super Admin independently gate
 * an institute's access to the LMS product itself. Defaults to true so every
 * institute that already exists today (all of which currently have LMS access
 * by virtue of having a row here at all) keeps working unchanged; new
 * ERP-only institutes enrolled going forward can be created with this false.
 */
export class AddLmsEnabledFlag1791400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE institutes
      ADD COLUMN IF NOT EXISTS lms_enabled BOOLEAN NOT NULL DEFAULT true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE institutes DROP COLUMN IF EXISTS lms_enabled`);
  }
}
