const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const hash = await bcrypt.hash('Admin@123', 10);
  console.log('bcryptjs hash generated:', hash);

  const res = await client.query(`
    UPDATE users
    SET password = $1, status = 'active', updated_at = NOW()
    WHERE email = 'superadmin@gmail.com' AND role = 'super_admin'
    RETURNING id, email, role, status;
  `, [hash]);

  console.log('Updated superadmin@gmail.com:', res.rows);
  await client.end();
}

run().catch(console.error);
