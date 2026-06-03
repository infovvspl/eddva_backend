import { MigrationInterface, QueryRunner } from "typeorm";

export class DropStaleTenantFkFromTopics1718000000000 implements MigrationInterface {
    name = 'DropStaleTenantFkFromTopics1718000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Drop the stale foreign key constraint that points to tenants
        await queryRunner.query(`ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "FK_44dc6b6f929c6894f621828e915"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore the constraint if we need to rollback
        await queryRunner.query(`ALTER TABLE "topics" ADD CONSTRAINT "FK_44dc6b6f929c6894f621828e915" FOREIGN KEY ("institute_id") REFERENCES "tenants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
