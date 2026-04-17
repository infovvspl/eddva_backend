import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingDoubtColumns1700000000020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE doubts
        ADD COLUMN IF NOT EXISTS ai_quality_rating VARCHAR,
        ADD COLUMN IF NOT EXISTS teacher_lecture_ref VARCHAR,
        ADD COLUMN IF NOT EXISTS teacher_response_image_url VARCHAR,
        ADD COLUMN IF NOT EXISTS is_teacher_response_helpful BOOLEAN,
        ADD COLUMN IF NOT EXISTS teacher_reviewed_at TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE doubts
        DROP COLUMN IF EXISTS ai_quality_rating,
        DROP COLUMN IF EXISTS teacher_lecture_ref,
        DROP COLUMN IF EXISTS teacher_response_image_url,
        DROP COLUMN IF EXISTS is_teacher_response_helpful,
        DROP COLUMN IF EXISTS teacher_reviewed_at;
    `);
  }
}
