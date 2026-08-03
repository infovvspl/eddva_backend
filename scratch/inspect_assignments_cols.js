const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'assignments'
  `);
  console.log('COLUMNS:', cols.rows);

  const sample = await client.query(`SELECT * FROM assignments LIMIT 1`);
  console.log('SAMPLE ROW:', sample.rows[0]);

  await client.end();
}

run().catch(console.error);
