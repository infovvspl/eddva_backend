import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A chapter gets a chapter roadmap only when its weakness is chapter-wide.
 * Its status pools every mark in the chapter, so one weak topic (the only one
 * a test covered) also made the whole chapter "weak". This stores the status
 * of the chapter-level marks alone (games, chapter-tagged tests), which the
 * mind map uses to tell the two apart. Filled by the next mastery recompute.
 */
export class AddChapterLevelStatus1792700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE student_chapter_mastery ADD COLUMN IF NOT EXISTS chapter_level_status VARCHAR(20) NOT NULL DEFAULT 'not_assessed'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE student_chapter_mastery DROP COLUMN IF EXISTS chapter_level_status`);
  }
}
