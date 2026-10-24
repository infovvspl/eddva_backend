import { MigrationInterface, QueryRunner } from 'typeorm';
import { LESSON_PLAN_DDL } from '../lesson-plan/lesson-plan.schema';

/**
 * Chapter lesson plans: a teacher creates one per chapter (AI, upload or by
 * hand), the institute admin approves it. Additive; the old per-session
 * `lesson_plans` table is left as it is.
 */
export class AddChapterLessonPlans1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of LESSON_PLAN_DDL) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS lesson_plan_notes`);
    await queryRunner.query(`DROP TABLE IF EXISTS lesson_plan_progress`);
    await queryRunner.query(`DROP TABLE IF EXISTS chapter_lesson_plan_periods`);
    await queryRunner.query(`DROP TABLE IF EXISTS chapter_lesson_plans`);
  }
}
