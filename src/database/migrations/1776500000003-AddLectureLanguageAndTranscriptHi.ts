import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLectureLanguageAndTranscriptHi1776500000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lectures
        ADD COLUMN IF NOT EXISTS lecture_language VARCHAR DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS transcript_hi TEXT NULL;
    `);
    // Backfill: lectures already transcribed in Hindi get lecture_language = 'hi'
    await queryRunner.query(`
      UPDATE lectures SET lecture_language = 'hi'
      WHERE transcript_language = 'hi' AND lecture_language IS DISTINCT FROM 'hi';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lectures
        DROP COLUMN IF EXISTS lecture_language,
        DROP COLUMN IF EXISTS transcript_hi;
    `);
  }
}
