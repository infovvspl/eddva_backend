import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hides every past "Replace" of a chapter's trained textbook, keeping only
 * the newest upload per chapter visible.
 *
 * uploadAndIndex (school-textbook.service.ts) inserts a fresh study_materials
 * row on every upload rather than updating one in place — there was no
 * deactivation of the row(s) it superseded until now, so each "Replace" on
 * the Textbook Coverage screen left the previous version sitting in
 * study_materials as still-active. The teacher-facing materials list
 * (school-material.service.ts's list()) has no "latest only" logic, so every
 * one of those old versions showed up as its own E-book entry in Course
 * Content instead of just the book actually being trained now.
 *
 * Scoped to rows the textbook pipeline itself created (content_source IS
 * NULL, never set by /school/materials' create(), and tracked in
 * textbook_link_status, written only by uploadAndIndex/auditLinks) — a
 * teacher's own "E-book" reference material for the same chapter is a
 * different, personal upload and is never touched by this.
 *
 * This is a one-time backfill for rows created before that fix; going
 * forward, uploadAndIndex deactivates the chapter's older pipeline rows
 * itself.
 */
export class DeactivateSupersededTextbooks1791700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // textbook_link_status is created lazily (SchoolTextbookService.ensureSchema)
    // on first use of the textbook feature, not by a migration — on an
    // environment that has never used it, there is nothing to back-fill.
    const [{ exists }] = await queryRunner.query(`SELECT to_regclass('public.textbook_link_status') IS NOT NULL AS exists`);
    if (!exists) return;

    await queryRunner.query(`
      UPDATE study_materials
      SET is_active = FALSE
      WHERE type = 'ebook'
        AND chapter_id IS NOT NULL
        AND content_source IS NULL
        AND id IN (SELECT material_id FROM textbook_link_status)
        AND id NOT IN (
          SELECT DISTINCT ON (chapter_id) id
          FROM study_materials
          WHERE type = 'ebook'
            AND chapter_id IS NOT NULL
            AND content_source IS NULL
            AND id IN (SELECT material_id FROM textbook_link_status)
          ORDER BY chapter_id, created_at DESC
        )
    `);
  }

  public async down(): Promise<void> {
    // A data backfill: rows this deactivated cannot be told apart from ones
    // that were already inactive before it ran.
  }
}
