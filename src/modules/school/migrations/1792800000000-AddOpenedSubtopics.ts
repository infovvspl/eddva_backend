import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The subtopics a student has opened a topic's path from (by clicking the
 * subtopic on a mind map), so the mind map can show them as opened (blue)
 * before any question on them has been answered.
 */
export class AddOpenedSubtopics1792800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE learning_threads ADD COLUMN IF NOT EXISTS opened_subtopics JSONB NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE learning_threads DROP COLUMN IF EXISTS opened_subtopics`);
  }
}
