const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const res = await client.query(`
    SELECT
      page_number AS "pageNumber",
      rects
    FROM school_material_highlights
    LIMIT 3
  `);

  res.rows.forEach((row, i) => {
    console.log(`--- Row ${i} ---`);
    console.log('pageNumber value:  ', row.pageNumber);
    console.log('pageNumber typeof: ', typeof row.pageNumber);
    console.log('pageNumber === 14: ', row.pageNumber === 14);
    console.log('pageNumber == 14:  ', row.pageNumber == 14);
    console.log('rects typeof:      ', typeof row.rects);
    console.log('Array.isArray:     ', Array.isArray(row.rects));
  });

  // Also check via JSON roundtrip — what does the API response object look like?
  const asJson = JSON.parse(JSON.stringify(res.rows[0]));
  console.log('\n--- After JSON.parse(JSON.stringify()) roundtrip ---');
  console.log('pageNumber value:  ', asJson.pageNumber);
  console.log('pageNumber typeof: ', typeof asJson.pageNumber);

  await client.end();
}

run().catch(err => { console.error(err.message); process.exit(1); });
