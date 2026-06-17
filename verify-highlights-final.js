const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected.\n');

  // ── PHASE 1: rects_type distribution ──────────────────────────────────────
  console.log('=== PHASE 1: rects type distribution ===');
  const phase1 = await client.query(`
    SELECT
      jsonb_typeof(rects) AS rects_type,
      COUNT(*) AS count
    FROM school_material_highlights
    GROUP BY rects_type
    ORDER BY count DESC
  `);
  if (phase1.rows.length === 0) {
    console.log('No rows in school_material_highlights.');
  } else {
    console.table(phase1.rows);
  }

  // ── PHASE 2: Inspect a raw row (newest) ──────────────────────────────────
  console.log('\n=== PHASE 2: Inspect newest highlight row ===');
  const phase2 = await client.query(`
    SELECT
      id,
      page_number AS "pageNumber",
      selected_text AS "selectedText",
      jsonb_typeof(rects) AS rects_type,
      rects,
      color,
      category,
      created_at
    FROM school_material_highlights
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (phase2.rows.length === 0) {
    console.log('No highlights found.');
  } else {
    const row = phase2.rows[0];
    console.log('id:            ', row.id);
    console.log('pageNumber:    ', row.pageNumber);
    console.log('selectedText:  ', row.selectedText?.slice(0, 50));
    console.log('rects_type:    ', row.rects_type);
    console.log('rects (JS):    ', JSON.stringify(row.rects));
    console.log('Array.isArray: ', Array.isArray(row.rects));
    console.log('rects[0]:      ', row.rects?.[0]);
    console.log('color:         ', row.color);
    console.log('category:      ', row.category);
    console.log('created_at:    ', row.created_at);
  }

  // ── PHASE 3: Any string rects remaining? ──────────────────────────────────
  console.log('\n=== PHASE 3: Any string-type rects remaining? ===');
  const phase3 = await client.query(`
    SELECT COUNT(*) AS string_count
    FROM school_material_highlights
    WHERE jsonb_typeof(rects) = 'string'
  `);
  console.log('string-type rects count:', phase3.rows[0].string_count);

  // ── PHASE 4: Sample old rows — confirm migration worked ───────────────────
  console.log('\n=== PHASE 4: All distinct rects types in table ===');
  const phase4 = await client.query(`
    SELECT
      jsonb_typeof(rects) AS rects_type,
      COUNT(*) AS count,
      MIN(created_at) AS oldest,
      MAX(created_at) AS newest
    FROM school_material_highlights
    GROUP BY rects_type
  `);
  console.table(phase4.rows);

  // ── PHASE 5: Verify rects is a parseable array ─────────────────────────────
  console.log('\n=== PHASE 5: Spot check rects[0] structure on 5 rows ===');
  const phase5 = await client.query(`
    SELECT
      id,
      jsonb_typeof(rects) AS rects_type,
      rects->0 AS first_rect,
      jsonb_array_length(
        CASE WHEN jsonb_typeof(rects) = 'array' THEN rects ELSE '[]'::jsonb END
      ) AS rect_count,
      created_at
    FROM school_material_highlights
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.table(phase5.rows.map(r => ({
    id: r.id.slice(0, 8) + '...',
    rects_type: r.rects_type,
    rect_count: r.rect_count,
    first_rect: JSON.stringify(r.first_rect),
    created_at: r.created_at?.toISOString?.()
  })));

  await client.end();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
