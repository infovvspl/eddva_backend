const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to DB');

  const res = await client.query(`
    SELECT *
    FROM users
    WHERE email ILIKE '%superadmin%' OR role = 'SUPER_ADMIN' OR email ILIKE '%admin%';
  `);
  
  console.log('Found users count:', res.rows.length);
  res.rows.forEach(u => {
    console.log({
      id: u.id,
      email: u.email,
      phone: u.phone || u.phone_number,
      role: u.role,
      status: u.status,
      password: u.password ? u.password.substring(0, 15) + '...' : null,
      created_at: u.created_at,
      updated_at: u.updated_at
    });
  });
  await client.end();
}

run().catch(console.error);
