import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranscriptStatusToLectures1776500000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transcript_status_enum') THEN
          CREATE TYPE transcript_status_enum AS ENUM ('pending', 'processing', 'done', 'failed');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE lectures
        ADD COLUMN IF NOT EXISTS transcript_status transcript_status_enum NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS transcript_language VARCHAR NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lectures
        DROP COLUMN IF EXISTS transcript_status,
        DROP COLUMN IF EXISTS transcript_language;
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS transcript_status_enum;`);
  }
}
