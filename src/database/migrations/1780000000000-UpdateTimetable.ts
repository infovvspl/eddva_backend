import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTimetable1780000000000 implements MigrationInterface {
  name = 'UpdateTimetable1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "timetables" ADD "period_number" integer`);
    await queryRunner.query(`ALTER TABLE "timetables" ADD "type" character varying DEFAULT 'offline'`);
    await queryRunner.query(`ALTER TABLE "timetables" ADD "meeting_link" text`);
    await queryRunner.query(`ALTER TABLE "timetables" ADD "remarks" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "remarks"`);
    await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "meeting_link"`);
    await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "type"`);
    await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "period_number"`);
  }
}
