import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Before FixErpModuleCatalogue, three ERP modules were manually added twice
 * under different keys/names: "Transport Management" / "Transport",
 * "Library Management" / "Library", "Sports Management" / "Sports". The
 * "X Management" rows have no `path` (they predate that column being used
 * consistently), so ERPWorkspace.jsx renders them as permanently "Coming
 * Soon" — while the correct, working row (with a `path`) sits right next to
 * them. This migration finds each such pair by name (stripping a trailing
 * "Management"), re-points any institute's existing assignment from the
 * pathless legacy row onto the working one, then removes the legacy row.
 * A module pair is only touched when one side has NO path and the other
 * DOES — a real module that happens to have "Management" in its name (e.g.
 * "Canteen Management", which has a path and no pathless twin) is untouched.
 */
export class DeduplicateErpModules1790400000000 implements MigrationInterface {
  name = 'DeduplicateErpModules1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Re-point (or merge) each institute's assignment from the legacy,
    // pathless module onto its canonical counterpart.
    await queryRunner.query(`
      INSERT INTO "school_erp_module_assignments" ("institute_id", "module_id", "is_active")
      SELECT a."institute_id", canonical."id", a."is_active"
      FROM "school_erp_module_assignments" a
      JOIN "school_erp_modules" legacy ON legacy."id" = a."module_id" AND legacy."path" IS NULL
      JOIN "school_erp_modules" canonical
        ON canonical."id" <> legacy."id"
        AND canonical."path" IS NOT NULL
        AND lower(regexp_replace(canonical."name", '\\s+management\\s*$', '', 'i')) =
            lower(regexp_replace(legacy."name", '\\s+management\\s*$', '', 'i'))
      ON CONFLICT ("institute_id", "module_id")
      DO UPDATE SET "is_active" = "school_erp_module_assignments"."is_active" OR EXCLUDED."is_active"
    `);

    // Drop the now-migrated assignment rows that still point at a legacy module.
    await queryRunner.query(`
      DELETE FROM "school_erp_module_assignments" a
      WHERE a."module_id" IN (
        SELECT legacy."id"
        FROM "school_erp_modules" legacy
        WHERE legacy."path" IS NULL
          AND EXISTS (
            SELECT 1 FROM "school_erp_modules" canonical
            WHERE canonical."id" <> legacy."id"
              AND canonical."path" IS NOT NULL
              AND lower(regexp_replace(canonical."name", '\\s+management\\s*$', '', 'i')) =
                  lower(regexp_replace(legacy."name", '\\s+management\\s*$', '', 'i'))
          )
      )
    `);

    // Drop the legacy module rows themselves.
    await queryRunner.query(`
      DELETE FROM "school_erp_modules" legacy
      WHERE legacy."path" IS NULL
        AND EXISTS (
          SELECT 1 FROM "school_erp_modules" canonical
          WHERE canonical."id" <> legacy."id"
            AND canonical."path" IS NOT NULL
            AND lower(regexp_replace(canonical."name", '\\s+management\\s*$', '', 'i')) =
                lower(regexp_replace(legacy."name", '\\s+management\\s*$', '', 'i'))
        )
    `);
  }

  public async down(): Promise<void> {
    // Irreversible by design: the legacy rows were broken duplicates (no
    // `path`, unusable in the UI), so recreating them would just reintroduce
    // the bug this migration fixes. Nothing to revert.
  }
}
