const { Client } = require('pg');

async function cleanup() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // 1. Export existing records
  console.log('=== EXPORTING ALL EXISTING RECORDS ===');
  const existing = await client.query(`SELECT * FROM school_material_highlights ORDER BY created_at DESC;`);
  console.log(`Found ${existing.rows.length} records to export.`);
  existing.rows.forEach((r, i) => {
    console.log(`Record ${i+1}: id=${r.id}, page=${r.page_number}, text="${r.selected_text?.substring(0, 40)}...", rects=${JSON.stringify(r.rects).length} bytes`);
  });

  // 2. Delete all
  console.log('\n=== DELETING ALL CORRUPTED RECORDS ===');
  await client.query(`DELETE FROM school_material_highlights;`);

  // 3. Verify
  const count = await client.query(`SELECT COUNT(*) FROM school_material_highlights;`);
  console.log(`\n=== POST-CLEANUP COUNT: ${count.rows[0].count} ===`);

  await client.end();
}

cleanup().catch(console.error);
