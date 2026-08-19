const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

client.connect().then(async () => {
  const res = await client.query("SELECT id, email, role FROM users WHERE institute_id = 'e9f3592d-851a-43be-9361-574e57722703' AND role IN ('STAFF', 'TEACHER') LIMIT 5");
  console.log(JSON.stringify(res.rows, null, 2));
}).catch(console.error).finally(() => client.end());
