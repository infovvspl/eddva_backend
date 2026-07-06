const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT id, email, role, status, length(email) as email_len, encode(email::bytea, 'hex') as hex_email
    FROM users
    WHERE email ILIKE '%superadmin@gmail.com%'
  `);

  console.log('User inspection:', res.rows);

  await client.end();
}

run();
