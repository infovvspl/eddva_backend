import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSectionIdToAssignments1780550000000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE assignments ADD COLUMN IF NOT EXISTS section_id UUID NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE assignments DROP COLUMN IF EXISTS section_id;
        `);
    }
}
