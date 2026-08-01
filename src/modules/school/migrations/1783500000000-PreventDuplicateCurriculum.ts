import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stop the same subject or chapter being created twice.
 *
 * Class 10 Economics existed twice at one school, each copy carrying its own set
 * of the same five chapters, so every chapter appeared twice on the coverage
 * screen. The application guard was supposed to prevent it but compared scope
 * with `IS NULL`, and SQL never matches NULL to NULL — a class-wide subject
 * therefore never collided with a section-scoped one. Nothing at the database
 * level backed that guard up: `subjects` and `chapters` had only primary keys.
 *
 * The indexes below use COALESCE on the nullable scope columns for exactly that
 * reason, and compare on the lower-cased, trimmed name so "DEVELOPMENT" and
 * "Development" are the same chapter.
 *
 * Creation is skipped, with a warning, if duplicates still exist — an index that
 * cannot be built must not block an otherwise good deploy. Merge them first via
 * GET /school/curriculum/duplicates, then re-run.
 */
export class PreventDuplicateCurriculum1783500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const subjectDupes = await queryRunner.query(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM subjects
        GROUP BY institute_id,
                 COALESCE(class_id::text, ''),
                 COALESCE(section_id::text, ''),
                 LOWER(BTRIM(name))
        HAVING count(*) > 1
      ) d
    `);
    if (Number(subjectDupes[0]?.n || 0) > 0) {
      console.warn(
        `[PreventDuplicateCurriculum] ${subjectDupes[0].n} duplicate subject group(s) remain — ` +
        `skipping the subjects index. Merge them via /school/curriculum/duplicates, then re-run.`,
      );
    } else {
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_subjects_scope_name
        ON subjects (
          institute_id,
          COALESCE(class_id::text, ''),
          COALESCE(section_id::text, ''),
          LOWER(BTRIM(name))
        )
      `);
    }

    const chapterDupes = await queryRunner.query(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM chapters
        GROUP BY subject_id, LOWER(BTRIM(name))
        HAVING count(*) > 1
      ) d
    `);
    if (Number(chapterDupes[0]?.n || 0) > 0) {
      console.warn(
        `[PreventDuplicateCurriculum] ${chapterDupes[0].n} duplicate chapter group(s) remain — ` +
        `skipping the chapters index. Merge them, then re-run.`,
      );
    } else {
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_chapters_subject_name
        ON chapters (subject_id, LOWER(BTRIM(name)))
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ux_chapters_subject_name`);
    await queryRunner.query(`DROP INDEX IF EXISTS ux_subjects_scope_name`);
  }
}
