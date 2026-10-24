import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets admins mark a fee record as fully exempt (free) with a reason category,
 * instead of only PAID/PENDING. Available to every institute, not tied to one
 * school. Existing rows are unaffected (both columns nullable, no status change).
 */
export class AddFeeExemption1792100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `status` is backed by a Postgres enum (fees_status_enum: pending/paid/overdue/partial) — add 'exempt' to it.
    await queryRunner.query(`ALTER TYPE fees_status_enum ADD VALUE IF NOT EXISTS 'exempt';`);
    await queryRunner.query(`
      ALTER TABLE fees
      ADD COLUMN IF NOT EXISTS exemption_category VARCHAR(100),
      ADD COLUMN IF NOT EXISTS exempted_by UUID,
      ADD COLUMN IF NOT EXISTS exempted_at TIMESTAMP;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop a single enum value without recreating the type; leaving
    // 'exempt' in fees_status_enum on rollback is harmless (no rows will use it).
    await queryRunner.query(`
      ALTER TABLE fees
      DROP COLUMN IF EXISTS exemption_category,
      DROP COLUMN IF EXISTS exempted_by,
      DROP COLUMN IF EXISTS exempted_at;
    `);
  }
}
