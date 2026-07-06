const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Copy hash from admin@edva.in to superadmin@gmail.com
  const res = await client.query(`
    UPDATE users
    SET password = (SELECT password FROM users WHERE email = 'admin@edva.in'),
        status = 'active',
        updated_at = NOW()
    WHERE email = 'superadmin@gmail.com' AND role = 'super_admin'
    RETURNING id, email, role, status;
  `);

  console.log('Synchronized superadmin@gmail.com in Coaching DB:', res.rows);
  await client.end();
}

run().catch(console.error);
