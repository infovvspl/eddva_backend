const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'activity_logs' AND column_name = 'institute_id'");
  console.log(res.rows);
  await client.end();
}
run();
