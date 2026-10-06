import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a `content_type` column to the `subjects` table so subjects can be
 * scoped to either school-curriculum content or competitive-exam content.
 *
 * Values:
 *   'school'      — standard school syllabus subject (default for all existing rows)
 *   'competitive' — competitive exam subject (JEE / NEET / UPSC / etc.)
 *
 * The new column is additive: all pre-existing subjects default to 'school' and
 * the current API continues to work without any query changes on the frontend
 * unless a `?contentType=` filter is explicitly passed.
 *
 * Uniqueness scope is also widened: a school "Physics" and a competitive
 * "Physics" can coexist under the same class/section, so the old unique
 * constraint (if present) is replaced with one that includes content_type.
 */
export class AddSubjectContentType1790300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add the column (idempotent)
    await queryRunner.query(`
      ALTER TABLE subjects
        ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) NOT NULL DEFAULT 'school';
    `);

    // 2. Back-fill: all existing subjects are school-curriculum subjects
    await queryRunner.query(`
      UPDATE subjects SET content_type = 'school' WHERE content_type IS NULL OR content_type = '';
    `);

    // 3. Add an index so filtering by content_type on large tables stays fast
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_subjects_content_type
        ON subjects (institute_id, content_type);
    `);

    // 4. Widen the partial unique index used by subject dedupe service to include
    //    content_type, so school and competitive subjects with the same name can
    //    coexist under the same class/section.
    //
    //    The old index (if it exists) is dropped first; the new one replaces it.
    //    Both ops are IF EXISTS / IF NOT EXISTS so re-running is safe.
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_subjects_unique_name_class_section;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_unique_name_class_section_type
        ON subjects (
          institute_id,
          LOWER(TRIM(name)),
          COALESCE(class_id::text,   ''),
          COALESCE(section_id::text, ''),
          content_type
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_subjects_unique_name_class_section_type;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_subjects_content_type;`);
    await queryRunner.query(`ALTER TABLE subjects DROP COLUMN IF EXISTS content_type;`);

    // Restore the old index (best effort — if it didn't exist before, this is a no-op)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_unique_name_class_section
        ON subjects (
          institute_id,
          LOWER(TRIM(name)),
          COALESCE(class_id::text,   ''),
          COALESCE(section_id::text, '')
        );
    `);
  }
}
