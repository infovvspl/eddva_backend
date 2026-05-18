import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExamYears1778648840014 implements MigrationInterface {
    name = 'AddExamYears1778648840014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."exam_year_enum" ADD VALUE IF NOT EXISTS '2029'`);
        await queryRunner.query(`ALTER TYPE "public"."exam_year_enum" ADD VALUE IF NOT EXISTS '2030'`);
        await queryRunner.query(`ALTER TYPE "public"."exam_year_enum" ADD VALUE IF NOT EXISTS '2031'`);
        await queryRunner.query(`ALTER TYPE "public"."exam_year_enum" ADD VALUE IF NOT EXISTS '2032'`);
        await queryRunner.query(`ALTER TYPE "public"."exam_year_enum" ADD VALUE IF NOT EXISTS '2033'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Empty down migration as postgres does not easily drop enum values
    }
}
