import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeacherIdToAssessments1780590000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add teacher_id column to assessments table
    await queryRunner.query(`
      ALTER TABLE assessments
      ADD COLUMN IF NOT EXISTS teacher_id UUID
    `);

    // Back-fill teacher_id for existing assessments where possible:
    // Match assessments to teachers via class_id + subject_id in teacher_academic_assignments
    await queryRunner.query(`
      UPDATE assessments a
      SET teacher_id = (
        SELECT ta.teacher_id
        FROM teacher_academic_assignments ta
        JOIN teachers t ON ta.teacher_id = t.id
        WHERE ta.class_id::text = a.class_id::text
          AND ta.subject_id::text = a.subject_id::text
        LIMIT 1
      )
      WHERE a.teacher_id IS NULL
        AND a.class_id IS NOT NULL
        AND a.subject_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE assessments DROP COLUMN IF EXISTS teacher_id
    `);
  }
}
