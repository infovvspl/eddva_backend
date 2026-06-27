import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRecordingHighlights1782114302238 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS class_recording_highlights (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                recording_id UUID NOT NULL REFERENCES class_recordings(id) ON DELETE CASCADE,
                created_by UUID NOT NULL,
                updated_by UUID,
                start_offset INT NOT NULL,
                end_offset INT NOT NULL,
                display_order INT NOT NULL,
                text TEXT NOT NULL,
                color VARCHAR(16) NOT NULL,
                notes_hash VARCHAR(64),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                deleted_at TIMESTAMPTZ NULL
            );
            CREATE INDEX IF NOT EXISTS idx_class_rec_hl_recording ON class_recording_highlights(recording_id);
            CREATE INDEX IF NOT EXISTS idx_class_rec_hl_start ON class_recording_highlights(start_offset);
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS idx_class_rec_hl_start;
            DROP INDEX IF EXISTS idx_class_rec_hl_recording;
            DROP TABLE IF EXISTS class_recording_highlights;
        `);
    }
}
