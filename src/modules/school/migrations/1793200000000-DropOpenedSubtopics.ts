import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the cosmetic "opened subtopics" marker (AddOpenedSubtopics):
 * subtopics now have their own real threads (learning_threads.subtopic_id,
 * AddSubtopicScopeToThreads), so a subtopic's own `thread` is the "opened"
 * signal — this column has had no reader since.
 */
export class DropOpenedSubtopics1793200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE learning_threads DROP COLUMN IF EXISTS opened_subtopics`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE learning_threads ADD COLUMN IF NOT EXISTS opened_subtopics JSONB NOT NULL DEFAULT '[]'::jsonb`);
  }
}
