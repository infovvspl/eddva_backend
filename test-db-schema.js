const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'timetables';
  `);
  console.log("COLUMNS:", JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
