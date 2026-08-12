const { Client } = require('pg');

async function checkDb() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(`SELECT id, chapter_allocations FROM syllabus_plans WHERE id = '7f8c015a-7047-44ca-81a8-9bf98c974f66'`);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

checkDb().catch(console.error);
