const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Hash password Admin@123 with bcrypt
  const hashedPassword = await bcrypt.hash('Admin@123', 12);

  const res = await client.query(`
    UPDATE users
    SET password = $1, status = 'active', updated_at = NOW()
    WHERE email = 'superadmin@gmail.com' AND role = 'super_admin'
    RETURNING id, email, role, status;
  `, [hashedPassword]);

  console.log('Updated superadmin@gmail.com in Coaching DB:', res.rows);

  await client.end();
}

run().catch(console.error);
