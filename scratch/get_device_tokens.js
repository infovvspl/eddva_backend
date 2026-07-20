const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`SELECT * FROM school_device_tokens`);
  console.log(`DEVICE TOKENS:`, res.rows);
  await client.end();
}

run().catch(console.error);
