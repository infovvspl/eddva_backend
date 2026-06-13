const { Client } = require('pg');

async function audit() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  // 1. Schema
  console.log('=== SCHEMA ===');
  const schema = await client.query(`
    SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'school_material_highlights'
    ORDER BY ordinal_position;
  `);
  console.table(schema.rows);

  // 2. Indexes
  console.log('\n=== INDEXES ===');
  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'school_material_highlights';
  `);
  console.table(indexes.rows);

  // 3. Constraints
  console.log('\n=== CONSTRAINTS ===');
  const constraints = await client.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'school_material_highlights'::regclass;
  `);
  console.table(constraints.rows);

  // 4. Actual records
  console.log('\n=== LAST 10 RECORDS ===');
  const records = await client.query(`
    SELECT id, page_number, selected_text, color, 
           jsonb_array_length(rects) AS rect_count,
           rects
    FROM school_material_highlights
    ORDER BY created_at DESC
    LIMIT 10;
  `);
  records.rows.forEach((row, i) => {
    console.log(`\n--- Record ${i + 1} ---`);
    console.log('ID:', row.id);
    console.log('Page:', row.page_number);
    console.log('Text:', row.selected_text?.substring(0, 80));
    console.log('Color:', row.color);
    console.log('Rect Count:', row.rect_count);
    console.log('Rects (first 3):', JSON.stringify(row.rects?.slice(0, 3), null, 2));
    if (row.rects?.length > 3) {
      console.log(`... and ${row.rects.length - 3} more rects`);
    }
  });

  // 5. Total count
  const count = await client.query(`SELECT COUNT(*) FROM school_material_highlights;`);
  console.log('\n=== TOTAL HIGHLIGHTS:', count.rows[0].count, '===');

  await client.end();
}

audit().catch(console.error);
