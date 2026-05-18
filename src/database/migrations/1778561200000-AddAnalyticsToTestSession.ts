import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAnalyticsToTestSession1778561200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "test_sessions" ADD COLUMN IF NOT EXISTS "accuracy" double precision`);
        await queryRunner.query(`ALTER TABLE "test_sessions" ADD COLUMN IF NOT EXISTS "avg_time_per_question" double precision`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "test_sessions" DROP COLUMN IF EXISTS "avg_time_per_question"`);
        await queryRunner.query(`ALTER TABLE "test_sessions" DROP COLUMN IF EXISTS "accuracy"`);
    }
}
