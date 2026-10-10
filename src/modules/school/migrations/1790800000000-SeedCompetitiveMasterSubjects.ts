import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the fixed, canonical competitive-exam subjects. JEE and NEET don't
 * have an open-ended set of subjects — it's always Physics/Chemistry/
 * Mathematics for JEE and Physics/Chemistry/Biology for NEET — so these
 * are seeded once here rather than left to free-text entry in the Super
 * Admin taxonomy screen (which invited inconsistent naming and subjects
 * that don't map to any real exam). Idempotent: relies on the existing
 * unique index on LOWER(TRIM(name)), so re-running this is a no-op.
 */
export class SeedCompetitiveMasterSubjects1790800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO competitive_master_subjects (name, exam_target_scope)
      VALUES
        ('Physics', 'both'),
        ('Chemistry', 'both'),
        ('Mathematics', 'jee'),
        ('Biology', 'neet')
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM competitive_master_subjects
      WHERE LOWER(TRIM(name)) IN ('physics', 'chemistry', 'mathematics', 'biology')
    `);
  }
}
