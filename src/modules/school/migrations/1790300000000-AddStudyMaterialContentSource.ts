import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records where a study material's content came from, mirroring
 * assessments.content_source: 'upload' (file/link), 'manual' (typed by a
 * teacher, e.g. flashcards) or 'ai' (saved from the AI generator).
 *
 * Nullable and additive: existing rows stay NULL and keep today's behaviour
 * (text-only materials are shown as AI-generated, as they all were).
 */
export class AddStudyMaterialContentSource1790300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS content_source VARCHAR(16) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE study_materials DROP COLUMN IF EXISTS content_source;
    `);
  }
}
