import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranscriptStatusToLectures1745820000001 implements MigrationInterface {
  name = 'AddTranscriptStatusToLectures1745820000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lectures" ADD COLUMN IF NOT EXISTS "transcript_status" varchar(20) DEFAULT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "lectures" ADD COLUMN IF NOT EXISTS "transcript_language" varchar(20) DEFAULT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "lectures" ADD COLUMN IF NOT EXISTS "lecture_language" varchar(20) DEFAULT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lectures" DROP COLUMN IF EXISTS "transcript_status"`);
    await queryRunner.query(`ALTER TABLE "lectures" DROP COLUMN IF EXISTS "transcript_language"`);
    await queryRunner.query(`ALTER TABLE "lectures" DROP COLUMN IF EXISTS "lecture_language"`);
  }
}
