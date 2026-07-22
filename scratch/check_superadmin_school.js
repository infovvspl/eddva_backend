const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT id, email, role, is_active, password
    FROM users
    WHERE email ILIKE '%superadmin%' OR role = 'SUPER_ADMIN';
  `);

  console.log('Superadmin users in School DB:');
  console.log(res.rows);

  await client.end();
}

run();
