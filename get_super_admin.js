const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("SELECT email FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1");
  console.log(res.rows);
  await client.end();
}
run();
