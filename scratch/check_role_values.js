const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT id, email, role, role::text as role_str, status
    FROM users
    WHERE email IN ('superadmin@gmail.com', 'admin@edva.in')
  `);

  console.log('Roles inspection:');
  console.log(res.rows);

  await client.end();
}

run();
