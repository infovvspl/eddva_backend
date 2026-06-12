const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%parent%' OR table_name LIKE '%guardian%' OR table_name LIKE '%student_user%'");
  console.log('Tables related to parent/guardian:', res.rows);
  await client.end();
}
run();
