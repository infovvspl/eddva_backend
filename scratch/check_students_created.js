const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const sectionId = '5e3ac02b-7113-47df-9d02-7f3e761ca252';
  const res = await client.query(`
    SELECT created_at, COUNT(*) as count 
    FROM students 
    WHERE section_id = $1 
    GROUP BY created_at
    ORDER BY created_at DESC
  `, [sectionId]);
  console.log(res.rows);

  await client.end();
}

run().catch(console.error);
