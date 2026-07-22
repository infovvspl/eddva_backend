const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const sessionId = '65ea13f4-d169-46c9-b88b-74b654a49b68';
  console.log(`--- Records for Session ${sessionId} ---`);
  const res = await client.query(`
    SELECT COUNT(*) as count
    FROM attendance_records r
    WHERE r.session_id = $1
  `, [sessionId]);
  console.log(res.rows);

  await client.end();
}

run().catch(console.error);
