import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBunnyStreamFields1776500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE live_sessions
        ADD COLUMN IF NOT EXISTS stream_type    VARCHAR NOT NULL DEFAULT 'agora',
        ADD COLUMN IF NOT EXISTS bunny_stream_id  VARCHAR NULL,
        ADD COLUMN IF NOT EXISTS bunny_stream_key VARCHAR NULL,
        ADD COLUMN IF NOT EXISTS bunny_hls_url    VARCHAR NULL,
        ADD COLUMN IF NOT EXISTS bunny_rtmp_url   VARCHAR NULL,
        ADD COLUMN IF NOT EXISTS bunny_library_id VARCHAR NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE live_sessions
        DROP COLUMN IF EXISTS stream_type,
        DROP COLUMN IF EXISTS bunny_stream_id,
        DROP COLUMN IF EXISTS bunny_stream_key,
        DROP COLUMN IF EXISTS bunny_hls_url,
        DROP COLUMN IF EXISTS bunny_rtmp_url,
        DROP COLUMN IF EXISTS bunny_library_id
    `);
  }
}
