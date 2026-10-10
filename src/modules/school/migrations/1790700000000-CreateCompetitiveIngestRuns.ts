import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks each PDF ingestion run for the Competitive Exam Prep global bank —
 * so Super Admin can see what was uploaded, its live page progress while
 * running, and its outcome (extracted/inserted counts, quality, errors)
 * afterwards. Mirrors `textbook_ingest_runs`' shape, scaled down to the
 * single-file-per-run case this vertical actually has (bulk multi-file runs
 * aren't a need here the way a whole-chapter-library re-index is for
 * textbooks).
 */
export class CreateCompetitiveIngestRuns1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS competitive_ingest_runs (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        status character varying NOT NULL DEFAULT 'running',
        file_name character varying,
        source character varying NOT NULL,
        master_subject_id uuid,
        exam_target character varying,
        exam_year integer,
        pages_total integer,
        pages_done integer NOT NULL DEFAULT 0,
        total_extracted integer,
        inserted integer,
        quality character varying,
        truncated boolean NOT NULL DEFAULT false,
        error_message text,
        created_by uuid,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        finished_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_competitive_ingest_runs" PRIMARY KEY (id),
        CONSTRAINT "CHK_cir_status" CHECK (status IN ('running', 'succeeded', 'failed'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cir_started_at ON competitive_ingest_runs (started_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS competitive_ingest_runs`);
  }
}
