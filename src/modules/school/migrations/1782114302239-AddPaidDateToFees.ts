import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaidDateToFees1782114302239 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE fees ADD COLUMN IF NOT EXISTS paid_date DATE NULL;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE fees DROP COLUMN IF EXISTS paid_date;
        `);
    }
}
