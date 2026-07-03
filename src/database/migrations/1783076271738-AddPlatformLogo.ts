import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlatformLogo1783076271738 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "platform_config" ADD "logo_url" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "platform_config" DROP COLUMN "logo_url"`);
    }

}
