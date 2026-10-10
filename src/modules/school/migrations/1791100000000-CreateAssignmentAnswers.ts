import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A student's (or group's) answer to each question of an assignment. One row
 * per submission and question; marks_awarded is NULL until a written answer is
 * graded by the teacher. Objective answers are graded on submit.
 */
export class CreateAssignmentAnswers1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_answers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL,
        submission_id UUID NOT NULL,
        question_id UUID NOT NULL,
        answer TEXT,
        is_correct BOOLEAN,
        marks_awarded NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_assignment_answer UNIQUE (submission_id, question_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_assignment_answers_assignment
      ON assignment_answers (assignment_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_answers`);
  }
}
