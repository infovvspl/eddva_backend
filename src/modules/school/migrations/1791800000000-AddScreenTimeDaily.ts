import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScreenTimeDaily1791800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS school_screen_time_daily (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        institute_id UUID NULL,
        session_date DATE NOT NULL,
        active_seconds INTEGER NOT NULL DEFAULT 0,
        last_heartbeat_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_user_id, session_date)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_screen_time_student_date
        ON school_screen_time_daily (student_user_id, session_date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS school_screen_time_daily`);
  }
}
