import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lesson Plan generation now produces one AI-generated Markdown brief (via the
 * real Groq-backed content pipeline, `lesson_brief` content type) instead of only
 * the 11 structured text fields this table already had. This column is additive —
 * a teacher can still fill the detailed form instead of, or alongside, the brief.
 */
export class AddLessonPlanAiBrief1790200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lesson_plans ADD COLUMN IF NOT EXISTS ai_brief TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lesson_plans DROP COLUMN IF EXISTS ai_brief;
    `);
  }
}
