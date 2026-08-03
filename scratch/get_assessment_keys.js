const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT * FROM assessments LIMIT 1`);
  console.log(`KEYS:`, Object.keys(res.rows[0]));
  await client.end();
}

run().catch(console.error);
