import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnouncementsTable1700000000013 implements MigrationInterface {
    name = 'AddAnnouncementsTable1700000000013';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "announcements" (
                "id"          UUID NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
                "deleted_at"  TIMESTAMPTZ,
                "title"       VARCHAR NOT NULL,
                "body"        TEXT NOT NULL,
                "target_role" VARCHAR,
                "tenant_id"   UUID,
                "created_by"  UUID,
                "expires_at"  TIMESTAMPTZ,
                "sent_count"  INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT "PK_announcements" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "announcements"
                ADD CONSTRAINT "FK_announcements_tenant"
                FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "announcements"
                ADD CONSTRAINT "FK_announcements_created_by"
                FOREIGN KEY ("created_by") REFERENCES "users"("id")
                ON DELETE SET NULL ON UPDATE NO ACTION
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" DROP CONSTRAINT IF EXISTS "FK_announcements_created_by"`);
        await queryRunner.query(`ALTER TABLE "announcements" DROP CONSTRAINT IF EXISTS "FK_announcements_tenant"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "announcements"`);
    }
}
