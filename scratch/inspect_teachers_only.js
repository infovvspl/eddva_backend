const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns 
    WHERE table_name = 'teachers'
    ORDER BY ordinal_position;
  `);
  console.log(`\nTable teachers:`);
  console.table(res.rows);
  await client.end();
}

run().catch(console.error);
