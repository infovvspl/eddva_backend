const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('--- SESSIONS ---');
  const sessions = await client.query('SELECT * FROM attendance_sessions LIMIT 5');
  console.log(sessions.rows);

  console.log('\n--- RECORDS ---');
  const records = await client.query('SELECT * FROM attendance_records LIMIT 5');
  console.log(records.rows);

  console.log('\n--- ATTENDANCES ---');
  const attendances = await client.query('SELECT * FROM attendances LIMIT 5');
  console.log(attendances.rows);

  await client.end();
}

run().catch(console.error);
