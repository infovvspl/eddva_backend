import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration to update unique constraint on classes table.
 * Changes UNIQUE (institute_id, name) -> UNIQUE (institute_id, academic_year, name)
 * so that classes with the same name can exist in different academic years for the same institute.
 */
export class UpdateClassUniqueConstraint1783200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop existing constraint if present
    await queryRunner.query(`
      ALTER TABLE classes
      DROP CONSTRAINT IF EXISTS classes_institute_id_name_key;
    `);

    // 2. Drop existing index if present
    await queryRunner.query(`
      DROP INDEX IF EXISTS classes_institute_id_name_key;
    `);

    // 3. Ensure no null academic_year exists before creating new constraint
    await queryRunner.query(`
      UPDATE classes
      SET academic_year = '2025-2026'
      WHERE academic_year IS NULL OR TRIM(academic_year) = '';
    `);

    // 4. Add composite unique constraint for (institute_id, academic_year, name)
    await queryRunner.query(`
      ALTER TABLE classes
      ADD CONSTRAINT classes_institute_id_academic_year_name_key
      UNIQUE (institute_id, academic_year, name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE classes
      DROP CONSTRAINT IF EXISTS classes_institute_id_academic_year_name_key;
    `);

    await queryRunner.query(`
      ALTER TABLE classes
      ADD CONSTRAINT classes_institute_id_name_key
      UNIQUE (institute_id, name);
    `);
  }
}
