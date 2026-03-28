import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveClassTables1700000000001 implements MigrationInterface {
  name = 'AddLiveClassTables1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE live_session_status_enum AS ENUM ('waiting','live','ended')`);

    await queryRunner.query(`
      CREATE TABLE live_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
        agora_channel_name VARCHAR NOT NULL UNIQUE,
        status live_session_status_enum NOT NULL DEFAULT 'waiting',
        teacher_agora_uid INT NOT NULL,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        peak_viewer_count INT NOT NULL DEFAULT 0,
        recording_resource_id VARCHAR,
        recording_sid VARCHAR,
        recording_url VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE live_attendances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        agora_uid INT NOT NULL,
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        duration_seconds INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE live_chat_messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_name VARCHAR NOT NULL,
        sender_role VARCHAR NOT NULL,
        message TEXT NOT NULL,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE live_polls (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options JSONB NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        correct_option_index INT,
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE live_poll_responses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        live_session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
        poll_id UUID NOT NULL REFERENCES live_polls(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        selected_option INT NOT NULL,
        responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_live_sessions_lecture_id ON live_sessions(lecture_id)`);
    await queryRunner.query(`CREATE INDEX idx_live_sessions_tenant_status ON live_sessions(tenant_id, status)`);
    await queryRunner.query(`CREATE INDEX idx_live_attendances_session_id ON live_attendances(live_session_id)`);
    await queryRunner.query(`CREATE INDEX idx_live_attendances_student_session ON live_attendances(student_id, live_session_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_live_attendances_session_student ON live_attendances(live_session_id, student_id)`);
    await queryRunner.query(`CREATE INDEX idx_live_chat_messages_session_sent_at ON live_chat_messages(live_session_id, sent_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_live_polls_session_active ON live_polls(live_session_id, is_active)`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_live_poll_responses_poll_student ON live_poll_responses(poll_id, student_id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS live_poll_responses CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS live_polls CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS live_chat_messages CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS live_attendances CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS live_sessions CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS live_session_status_enum`);
  }
}
