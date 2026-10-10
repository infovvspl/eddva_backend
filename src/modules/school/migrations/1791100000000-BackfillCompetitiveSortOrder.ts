import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every chapter/topic created so far has `sort_order = 0` (the old default),
 * so the list screen was sorting them alphabetically by name instead of in
 * the order they were actually added — a freshly-added chapter could land
 * above older ones just because its name came first alphabetically.
 * Backfills sort_order from created_at, per parent, so existing rows read
 * in creation order; new rows go through `nextSortOrder` in
 * CompetitiveMasterService and append after whatever this backfill sets.
 */
export class BackfillCompetitiveSortOrder1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE competitive_master_chapters c
      SET sort_order = ranked.rn
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY master_subject_id ORDER BY created_at) - 1 AS rn
        FROM competitive_master_chapters
      ) ranked
      WHERE c.id = ranked.id
    `);
    await queryRunner.query(`
      UPDATE competitive_master_topics t
      SET sort_order = ranked.rn
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY master_chapter_id ORDER BY created_at) - 1 AS rn
        FROM competitive_master_topics
      ) ranked
      WHERE t.id = ranked.id
    `);
  }

  public async down(): Promise<void> {
    // Not reversible in a meaningful way — the original all-zero state
    // carried no information worth restoring.
  }
}
