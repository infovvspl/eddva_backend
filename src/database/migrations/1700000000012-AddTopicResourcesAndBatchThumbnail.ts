import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTopicResourcesAndBatchThumbnail1700000000012 implements MigrationInterface {
    name = 'AddTopicResourcesAndBatchThumbnail1700000000012';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create resource_type enum
        await queryRunner.query(`
            CREATE TYPE "public"."resource_type_enum" AS ENUM('pdf', 'dpp', 'quiz', 'notes', 'video')
        `);

        // Create topic_resources table
        await queryRunner.query(`
            CREATE TABLE "topic_resources" (
                "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
                "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
                "deleted_at"     TIMESTAMPTZ,
                "tenant_id"      UUID NOT NULL,
                "topic_id"       UUID NOT NULL,
                "uploaded_by"    UUID NOT NULL,
                "type"           "public"."resource_type_enum" NOT NULL,
                "title"          VARCHAR NOT NULL,
                "file_url"       VARCHAR NOT NULL,
                "file_size_kb"   INTEGER,
                "description"    VARCHAR,
                "sort_order"     INTEGER NOT NULL DEFAULT 0,
                "is_active"      BOOLEAN NOT NULL DEFAULT true,
                CONSTRAINT "PK_topic_resources" PRIMARY KEY ("id")
            )
        `);

        // FK: topic_resources → tenants
        await queryRunner.query(`
            ALTER TABLE "topic_resources"
                ADD CONSTRAINT "FK_topic_resources_tenant"
                FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
                ON DELETE NO ACTION ON UPDATE NO ACTION
        `);

        // FK: topic_resources → topics (cascade delete)
        await queryRunner.query(`
            ALTER TABLE "topic_resources"
                ADD CONSTRAINT "FK_topic_resources_topic"
                FOREIGN KEY ("topic_id") REFERENCES "topics"("id")
                ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        // Add thumbnail_url column to batches
        await queryRunner.query(`
            ALTER TABLE "batches"
                ADD COLUMN IF NOT EXISTS "thumbnail_url" VARCHAR
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "batches" DROP COLUMN IF EXISTS "thumbnail_url"`);
        await queryRunner.query(`ALTER TABLE "topic_resources" DROP CONSTRAINT IF EXISTS "FK_topic_resources_topic"`);
        await queryRunner.query(`ALTER TABLE "topic_resources" DROP CONSTRAINT IF EXISTS "FK_topic_resources_tenant"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "topic_resources"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."resource_type_enum"`);
    }
}
