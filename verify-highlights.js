const { Client } = require('pg');

async function verify() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // Count
  const count = await client.query(`SELECT COUNT(*) FROM school_material_highlights;`);
  console.log('TOTAL RECORDS:', count.rows[0].count);

  if (parseInt(count.rows[0].count) > 0) {
    // Show all records
    const rows = await client.query(`
      SELECT id, page_number, selected_text, color,
             jsonb_array_length(rects) AS rect_count,
             rects
      FROM school_material_highlights
      ORDER BY created_at DESC;
    `);
    rows.rows.forEach((row, i) => {
      console.log(`\n--- Record ${i + 1} ---`);
      console.log('ID:', row.id);
      console.log('Page:', row.page_number);
      console.log('Text:', row.selected_text?.substring(0, 80));
      console.log('Color:', row.color);
      console.log('Rect Count:', row.rect_count);
      console.log('Rects:', JSON.stringify(row.rects, null, 2));

      // Validation checks
      const issues = [];
      row.rects.forEach((r, j) => {
        if (r.width <= 0.5) issues.push(`Rect ${j}: width=${r.width} (too small)`);
        if (r.height <= 0.1) issues.push(`Rect ${j}: height=${r.height} (too small)`);
        if (r.y > 100) issues.push(`Rect ${j}: y=${r.y} (off page)`);
        if (r.x > 100) issues.push(`Rect ${j}: x=${r.x} (off page)`);
      });
      if (issues.length > 0) {
        console.log('ISSUES:', issues);
      } else {
        console.log('VALIDATION: PASS ✓');
      }
    });
  } else {
    console.log('Database is clean. Ready for Phase 1F testing.');
  }

  await client.end();
}

verify().catch(console.error);
