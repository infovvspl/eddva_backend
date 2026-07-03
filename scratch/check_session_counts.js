const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('--- Sessions and their Records Count ---');
  const res = await client.query(`
    SELECT asess.id, asess.date, asess.period, asess.class_id, asess.section_id, COUNT(ar.id) as records_count
    FROM attendance_sessions asess
    LEFT JOIN attendance_records ar ON asess.id = ar.session_id
    GROUP BY asess.id, asess.date, asess.period, asess.class_id, asess.section_id
    ORDER BY asess.date DESC
  `);
  console.log(res.rows);

  await client.end();
}

run().catch(console.error);
