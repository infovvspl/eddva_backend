import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAssignmentSubmissions1780550000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS assignment_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assignment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        file_path TEXT,
        notes TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'submitted',
        marks DOUBLE PRECISION,
        feedback TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_assignment_student UNIQUE (assignment_id, student_id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment
      ON assignment_submissions (assignment_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS assignment_submissions`);
  }
}
