const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/eddva'
});

async function test() {
  await client.connect();
  const res = await client.query('SELECT page_number, rects FROM school_material_highlights LIMIT 1');
  console.log('Row:', res.rows[0]);
  console.log('page_number type:', typeof res.rows[0].page_number);
  console.log('rects type:', typeof res.rows[0].rects);
  await client.end();
}

test().catch(console.error);
