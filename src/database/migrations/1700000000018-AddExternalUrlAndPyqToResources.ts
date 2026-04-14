import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalUrlAndPyqToResources1700000000018 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Make file_url nullable (for URL-only resources like YouTube links)
    await runner.query(`
      ALTER TABLE topic_resources
      ALTER COLUMN file_url DROP NOT NULL
    `);

    // Add external_url column for YouTube / external links
    await runner.query(`
      ALTER TABLE topic_resources
      ADD COLUMN IF NOT EXISTS external_url TEXT NULL
    `);

    // Add new enum values — actual type name is 'resource_type_enum'
    await runner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'pyq'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type_enum')
        ) THEN
          ALTER TYPE resource_type_enum ADD VALUE 'pyq';
        END IF;
      END
      $$
    `);

    await runner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'link'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'resource_type_enum')
        ) THEN
          ALTER TYPE resource_type_enum ADD VALUE 'link';
        END IF;
      END
      $$
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE topic_resources DROP COLUMN IF EXISTS external_url`);
    // PostgreSQL does not support removing enum values — type changes cannot be reverted
    await runner.query(`ALTER TABLE topic_resources ALTER COLUMN file_url SET NOT NULL`);
  }
}

