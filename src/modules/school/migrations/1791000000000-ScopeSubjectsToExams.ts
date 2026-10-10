import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Subjects become a real child of exams instead of a flat list with a
 * loose `exam_target_scope` string label next to a separately-managed
 * exam list. JEE and NEET don't actually share a syllabus — NEET Biology
 * doesn't exist in JEE at all, and even "Physics" differs in chapter
 * emphasis between the two — so each exam gets its own independent
 * Subject -> Chapter -> Topic tree, even where subject names repeat
 * across exams.
 *
 * Nothing references the 4 old flat subject rows yet (checked live:
 * 0 chapters, 0 institute offerings, 0 questions), so this replaces them
 * outright rather than needing a data-preserving backfill.
 */
export class ScopeSubjectsToExams1791000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM competitive_master_subjects`);

    await queryRunner.query(`
      ALTER TABLE competitive_master_subjects
        ADD COLUMN IF NOT EXISTS exam_id uuid
    `);

    await queryRunner.query(`
      ALTER TABLE competitive_master_subjects
        ADD CONSTRAINT "FK_cms_exam" FOREIGN KEY (exam_id)
          REFERENCES competitive_master_exams (id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE competitive_master_subjects ALTER COLUMN exam_id SET NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_cms_name`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_exam_name
        ON competitive_master_subjects (exam_id, LOWER(TRIM(name)))
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cms_exam ON competitive_master_subjects (exam_id)
    `);

    await queryRunner.query(`
      ALTER TABLE competitive_master_subjects DROP COLUMN IF EXISTS exam_target_scope
    `);

    // Re-seed per exam — JEE Mains/Advanced: Physics, Chemistry, Mathematics;
    // NEET: Physics, Chemistry, Biology.
    await queryRunner.query(`
      INSERT INTO competitive_master_subjects (exam_id, name)
      SELECT e.id, s.name
      FROM competitive_master_exams e
      CROSS JOIN LATERAL (
        SELECT unnest(
          CASE
            WHEN e.code = 'neet' THEN ARRAY['Physics', 'Chemistry', 'Biology']
            ELSE ARRAY['Physics', 'Chemistry', 'Mathematics']
          END
        ) AS name
      ) s
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM competitive_master_subjects`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cms_exam`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cms_exam_name`);
    await queryRunner.query(`ALTER TABLE competitive_master_subjects DROP CONSTRAINT IF EXISTS "FK_cms_exam"`);
    await queryRunner.query(`ALTER TABLE competitive_master_subjects DROP COLUMN IF EXISTS exam_id`);
    await queryRunner.query(`
      ALTER TABLE competitive_master_subjects
        ADD COLUMN IF NOT EXISTS exam_target_scope character varying NOT NULL DEFAULT 'both'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_name
        ON competitive_master_subjects (LOWER(TRIM(name)))
    `);
  }
}
