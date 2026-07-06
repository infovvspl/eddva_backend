import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryPriorityToAnnouncements1783100000000 implements MigrationInterface {
    name = 'AddCategoryPriorityToAnnouncements1783100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create the enum types
        await queryRunner.query(`
            CREATE TYPE "announcement_category_enum" AS ENUM ('GENERAL', 'ACADEMIC', 'ADMINISTRATIVE', 'MAINTENANCE', 'EMERGENCY')
        `);

        await queryRunner.query(`
            CREATE TYPE "announcement_priority_enum" AS ENUM ('NORMAL', 'HIGH', 'URGENT')
        `);

        // Add the columns with defaults
        await queryRunner.query(`
            ALTER TABLE "announcements"
                ADD COLUMN "category" "announcement_category_enum" NOT NULL DEFAULT 'GENERAL'
        `);

        await queryRunner.query(`
            ALTER TABLE "announcements"
                ADD COLUMN "priority" "announcement_priority_enum" NOT NULL DEFAULT 'NORMAL'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "priority"`);
        await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "category"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "announcement_priority_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "announcement_category_enum"`);
    }
}
