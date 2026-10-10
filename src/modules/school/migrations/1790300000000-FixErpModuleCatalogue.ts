import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `school_erp_modules` / `school_erp_module_assignments` were never created by
 * a tracked migration — they exist only in the live DB, created out-of-band.
 * The live assignments table keys on `school_id`, while the TypeORM entity
 * (`ErpModuleAssignment`) and every other ERP table in this codebase use
 * `institute_id`; `school_erp_modules` is also missing `sort_order`, which the
 * Super Admin service already reads/writes. This migration brings both tables
 * under version control and reconciles them with the entities, handling both
 * a fresh install (tables don't exist yet) and the pre-existing live shape
 * (school_id, no sort_order) in the same pass.
 */
export class FixErpModuleCatalogue1790300000000 implements MigrationInterface {
  name = 'FixErpModuleCatalogue1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── school_erp_modules ──────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "school_erp_modules" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" VARCHAR NOT NULL,
        "name" VARCHAR NOT NULL,
        "description" VARCHAR,
        "path" VARCHAR,
        "icon" VARCHAR,
        "color" VARCHAR,
        "bg" VARCHAR,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_school_erp_modules_key" UNIQUE ("key")
      )
    `);

    // Patch columns onto the pre-existing live table (a fresh table already has these).
    await queryRunner.query(`ALTER TABLE "school_erp_modules" ADD COLUMN IF NOT EXISTS "path" VARCHAR`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" ADD COLUMN IF NOT EXISTS "bg" VARCHAR`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    // ── school_erp_module_assignments ───────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "school_erp_module_assignments" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "institute_id" UUID NOT NULL,
        "module_id" UUID NOT NULL,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Re-key a pre-existing live table from school_id to institute_id.
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ADD COLUMN IF NOT EXISTS "institute_id" UUID`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'school_erp_module_assignments' AND column_name = 'school_id'
        ) THEN
          UPDATE "school_erp_module_assignments" SET "institute_id" = "school_id" WHERE "institute_id" IS NULL;
          -- Dropping the column also drops any same-table constraint/index that
          -- references it (unique constraint or plain unique index alike) —
          -- no manual lookup needed.
          ALTER TABLE "school_erp_module_assignments" DROP COLUMN "school_id";
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ALTER COLUMN "institute_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'school_erp_module_assignments' AND c.contype = 'u'
        ) THEN
          ALTER TABLE "school_erp_module_assignments"
            ADD CONSTRAINT "UQ_school_erp_module_assignments_institute_module" UNIQUE ("institute_id", "module_id");
        END IF;
      END $$;
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_school_erp_module_assignments_institute" ON "school_erp_module_assignments" ("institute_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_school_erp_module_assignments_module" ON "school_erp_module_assignments" ("module_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_school_erp_module_assignments_module"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_school_erp_module_assignments_institute"`);

    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ADD COLUMN IF NOT EXISTS "school_id" UUID`);
    await queryRunner.query(`UPDATE "school_erp_module_assignments" SET "school_id" = "institute_id" WHERE "school_id" IS NULL`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'school_erp_module_assignments' AND conname = 'UQ_school_erp_module_assignments_institute_module'
        ) THEN
          ALTER TABLE "school_erp_module_assignments" DROP CONSTRAINT "UQ_school_erp_module_assignments_institute_module";
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" DROP COLUMN IF EXISTS "institute_id"`);
    await queryRunner.query(`ALTER TABLE "school_erp_module_assignments" ALTER COLUMN "school_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "school_erp_module_assignments"
        ADD CONSTRAINT "school_erp_module_assignments_school_id_module_id_key" UNIQUE ("school_id", "module_id")
    `);

    await queryRunner.query(`ALTER TABLE "school_erp_modules" DROP COLUMN IF EXISTS "sort_order"`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" DROP COLUMN IF EXISTS "bg"`);
    await queryRunner.query(`ALTER TABLE "school_erp_modules" DROP COLUMN IF EXISTS "path"`);
  }
}
