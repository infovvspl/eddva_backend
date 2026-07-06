const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT id, email, full_name, role::text as role_str, status, updated_at
    FROM users
    WHERE status = 'inactive'
    ORDER BY updated_at DESC
  `);

  console.log('Inactive users count:', res.rows.length);
  console.log(res.rows);

  await client.end();
}

run();
