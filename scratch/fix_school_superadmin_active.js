const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    UPDATE users
    SET is_active = true
    WHERE email = 'superadmin@gmail.com' OR role = 'SUPER_ADMIN'
    RETURNING id, email, role, is_active;
  `);

  console.log('Updated superadmin users in School DB:');
  console.log(res.rows);

  await client.end();
}

run();
