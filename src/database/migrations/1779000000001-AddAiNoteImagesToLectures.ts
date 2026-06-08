import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiNoteImagesToLectures1779000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lectures
        ADD COLUMN IF NOT EXISTS ai_note_images JSONB NOT NULL DEFAULT '[]';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lectures
        DROP COLUMN IF EXISTS ai_note_images;
    `);
  }
}
