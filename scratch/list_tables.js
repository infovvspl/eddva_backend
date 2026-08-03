const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const res = await c.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log("Tables in DB:", res.rows.map(r => r.table_name));

  await c.end();
}
run();
