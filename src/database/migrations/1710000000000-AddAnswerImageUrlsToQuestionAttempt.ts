import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnswerImageUrlsToQuestionAttempt1710000000000 implements MigrationInterface {
  name = 'AddAnswerImageUrlsToQuestionAttempt1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "question_attempts"
      ADD COLUMN IF NOT EXISTS "answer_image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "question_attempts"
      DROP COLUMN IF EXISTS "answer_image_urls"
    `);
  }
}

