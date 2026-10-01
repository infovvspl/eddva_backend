/* eslint-disable no-console */
/**
 * Finds and repairs textbook grounding data left behind by the chapter-merge
 * bug in SchoolTopicService.listChapters(): duplicate chapter rows were
 * collapsed by deleting the loser without repointing textbook_chunks /
 * textbook_sources / textbook_link_status, so those rows can be left
 * pointing at a chapter_id that no longer exists in `chapters` — invisible
 * to a direct lookup, and (before the getChapterPassages fix) sometimes
 * surfaced under the WRONG chapter via the old institute-wide by-name
 * fallback.
 *
 * Recovery strategy: every textbook_chunks row still carries its original
 * material_id. study_materials.chapter_id was correctly repointed to the
 * surviving chapter by the same merge, so it tells us where an orphaned
 * chunk actually belongs now. A chunk is auto-repointed only when that
 * target chapter currently has ZERO chunks of its own — i.e. we are
 * restoring its only known copy, never merging two chapters' content
 * together. Anything less certain is reported, not touched.
 *
 * Usage:
 *   node scripts/repair-orphaned-textbook-chunks.js                  # report only
 *   node scripts/repair-orphaned-textbook-chunks.js --institute=<id> # scope to one institute
 *   node scripts/repair-orphaned-textbook-chunks.js --apply          # actually repoint safe cases
 */
require('dotenv').config();
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');
const instituteArg = process.argv.find((a) => a.startsWith('--institute='));
const INSTITUTE_ID = instituteArg ? instituteArg.split('=')[1] : null;

function dbOptions() {
  const url = process.env.SCHOOL_DB_URL;
  if (!url) throw new Error('SCHOOL_DB_URL is not set (check eddva_backend/.env)');
  return { connectionString: url, ssl: { rejectUnauthorized: false } };
}

function preview(value, max = 140) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, max);
}

async function main() {
  const client = new Client(dbOptions());
  await client.connect();
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'REPORT ONLY (pass --apply to fix)'}`);
  if (INSTITUTE_ID) console.log(`Scoped to institute: ${INSTITUTE_ID}`);

  try {
    // ── 1. Orphaned textbook_chunks: chapter_id no longer exists in `chapters` ──
    const orphanGroups = await client.query(
      `SELECT tc.chapter_id, tc.material_id, tc.institute_id,
              COUNT(*) AS chunk_count,
              MIN(tc.content) AS sample_content
       FROM textbook_chunks tc
       LEFT JOIN chapters c ON c.id = tc.chapter_id
       WHERE c.id IS NULL
         ${INSTITUTE_ID ? 'AND tc.institute_id = $1' : ''}
       GROUP BY tc.chapter_id, tc.material_id, tc.institute_id
       ORDER BY chunk_count DESC`,
      INSTITUTE_ID ? [INSTITUTE_ID] : [],
    );

    console.log(`\nOrphaned textbook_chunks groups: ${orphanGroups.rows.length}`);

    let autoFixed = 0;
    let needsReview = 0;
    let unrecoverable = 0;

    for (const g of orphanGroups.rows) {
      const label = `chapter_id=${g.chapter_id} material_id=${g.material_id} institute=${g.institute_id} (${g.chunk_count} chunks) — "${preview(g.sample_content, 80)}"`;

      if (!g.material_id) {
        console.log(`  [UNRECOVERABLE — no material_id] ${label}`);
        unrecoverable++;
        continue;
      }

      // Where does this material's chapter actually live now?
      const smRows = await client.query(
        `SELECT sm.chapter_id, c.name AS chapter_name, c.subject_id, s.class_id
         FROM study_materials sm
         JOIN chapters c ON c.id = sm.chapter_id
         JOIN subjects s ON s.id = c.subject_id
         WHERE sm.id = $1`,
        [g.material_id],
      );
      const target = smRows.rows[0];

      if (!target) {
        console.log(`  [UNRECOVERABLE — material or its chapter link is gone] ${label}`);
        unrecoverable++;
        continue;
      }

      const targetCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM textbook_chunks WHERE chapter_id = $1`,
        [target.chapter_id],
      );

      if (targetCount.rows[0].n > 0) {
        console.log(`  [NEEDS REVIEW — target chapter "${target.chapter_name}" (${target.chapter_id}) already has its own chunks; not auto-merging] ${label}`);
        needsReview++;
        continue;
      }

      console.log(`  [${APPLY ? 'REPOINTING' : 'WOULD REPOINT'} -> "${target.chapter_name}" (${target.chapter_id})] ${label}`);
      autoFixed++;

      if (!APPLY) continue;

      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE textbook_chunks
              SET chapter_id = $1, subject_id = $2, class_id = $3
            WHERE chapter_id = $4 AND material_id = $5`,
          [target.chapter_id, target.subject_id, target.class_id, g.chapter_id, g.material_id],
        );

        // Bring textbook_sources' summary in line so the coverage screen
        // reflects reality immediately, without requiring a re-index.
        const stats = await client.query(
          `SELECT COUNT(*)::int AS chunk_count, SUM(tokens)::int AS total_tokens,
                  MAX(page_no)::int AS pages
           FROM textbook_chunks WHERE chapter_id = $1`,
          [target.chapter_id],
        );
        const s = stats.rows[0];
        await client.query(
          `INSERT INTO textbook_sources
             (chapter_id, institute_id, material_id, pages, chunk_count, total_tokens, method, quality, ingested_at)
           VALUES ($1,$2,$3,$4,$5,$6,'text_layer','ok',NOW())
           ON CONFLICT (chapter_id) DO UPDATE SET
             institute_id = EXCLUDED.institute_id, material_id = EXCLUDED.material_id,
             pages = EXCLUDED.pages, chunk_count = EXCLUDED.chunk_count,
             total_tokens = EXCLUDED.total_tokens, ingested_at = NOW()`,
          [target.chapter_id, g.institute_id, g.material_id, s.pages || 0, s.chunk_count, s.total_tokens || 0],
        );

        // Drop whatever summary row was left under the now-nonexistent chapter_id.
        await client.query(`DELETE FROM textbook_sources WHERE chapter_id = $1`, [g.chapter_id]);
        await client.query(
          `UPDATE textbook_link_status SET chapter_id = $1 WHERE chapter_id = $2`,
          [target.chapter_id, g.chapter_id],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`    FAILED to repoint ${g.chapter_id} -> ${target.chapter_id}: ${err.message}`);
        autoFixed--;
        needsReview++;
      }
    }

    // ── 2. Orphaned textbook_sources / textbook_link_status with no matching chunk group ──
    const orphanSources = await client.query(
      `SELECT ts.chapter_id, ts.institute_id, ts.chunk_count
       FROM textbook_sources ts
       LEFT JOIN chapters c ON c.id = ts.chapter_id
       WHERE c.id IS NULL
         ${INSTITUTE_ID ? 'AND ts.institute_id = $1' : ''}`,
      INSTITUTE_ID ? [INSTITUTE_ID] : [],
    );
    if (orphanSources.rows.length) {
      console.log(`\nOrphaned textbook_sources rows (chapter no longer exists): ${orphanSources.rows.length}`);
      for (const r of orphanSources.rows) {
        console.log(`  chapter_id=${r.chapter_id} institute=${r.institute_id} chunk_count=${r.chunk_count}`);
        if (APPLY) {
          await client.query(`DELETE FROM textbook_sources WHERE chapter_id = $1`, [r.chapter_id]);
        }
      }
      console.log(APPLY ? '  -> deleted (their chunks were handled above, or are unrecoverable).' : '  -> pass --apply to delete these stale summary rows.');
    }

    // ── 3. At-risk chapters: currently 0 chunks of their own, but share a
    //        normalized name with a same-subject/class chapter that IS indexed
    //        — these are exactly the shape that relies on the by-name fallback. ──
    const atRisk = await client.query(
      `SELECT c.id AS chapter_id, c.name, s.name AS subject_name, cl.name AS class_name, cl.institute_id,
              other.id AS matches_chapter_id
       FROM chapters c
       JOIN subjects s ON s.id = c.subject_id
       LEFT JOIN classes cl ON cl.id = s.class_id
       LEFT JOIN textbook_sources own ON own.chapter_id = c.id AND own.chunk_count > 0
       JOIN chapters other ON other.subject_id = c.subject_id
                           AND other.id <> c.id
                           AND LOWER(TRIM(other.name)) = LOWER(TRIM(c.name))
       JOIN textbook_sources os ON os.chapter_id = other.id AND os.chunk_count > 0
       WHERE own.chapter_id IS NULL
         ${INSTITUTE_ID ? 'AND cl.institute_id = $1' : ''}`,
      INSTITUTE_ID ? [INSTITUTE_ID] : [],
    );
    if (atRisk.rows.length) {
      console.log(`\nAt-risk chapters (unindexed, but a same-name/same-subject duplicate IS indexed — currently served via name fallback): ${atRisk.rows.length}`);
      for (const r of atRisk.rows) {
        console.log(`  "${r.name}" (${r.chapter_id}) in ${r.subject_name}/${r.class_name || '?'}, institute=${r.institute_id} — served from duplicate ${r.matches_chapter_id}. Recommend merging these chapters (super-admin curriculum dedupe tool) rather than leaving this as-is.`);
      }
    }

    console.log(`\nSummary: ${autoFixed} ${APPLY ? 'repointed' : 'auto-fixable'}, ${needsReview} need manual review, ${unrecoverable} unrecoverable, ${atRisk.rows.length} at-risk (fallback-served).`);
    if (!APPLY && (autoFixed > 0 || orphanSources.rows.length > 0)) {
      console.log('Re-run with --apply to write these fixes.');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
