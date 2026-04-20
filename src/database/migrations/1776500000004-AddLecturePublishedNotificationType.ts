import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLecturePublishedNotificationType1776500000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'lecture_published';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing enum values; this is intentionally a no-op.
  }
}
