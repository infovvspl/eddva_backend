const { Client } = require('pg');
const bcrypt = require('bcryptjs') || require('bcrypt');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.COACHING_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to Coaching DB!');

    const res = await client.query(`
      SELECT id, email, full_name, role::text as role_str, status, created_at, updated_at, password
      FROM users
      WHERE email ILIKE '%superadmin%' OR email ILIKE '%admin%' OR role::text LIKE '%SUPER%' OR role::text LIKE '%ADMIN%'
    `);

    console.log(`\nFound ${res.rows.length} admin/superadmin users in Coaching DB:`);
    for (const u of res.rows) {
      console.log({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role_str,
        status: u.status,
        created_at: u.created_at,
        updated_at: u.updated_at,
        password_prefix: u.password ? u.password.substring(0, 15) + '...' : null
      });

      if (u.password) {
        const passwordsToTest = ['Admin@123', 'admin@123', 'admin', '123456', 'superadmin', 'Superadmin@123', '123'];
        for (const pwd of passwordsToTest) {
          try {
            const match = await bcrypt.compare(pwd, u.password);
            if (match) {
              console.log(`  ==> MATCH FOUND for ${u.email}: password is "${pwd}"`);
            }
          } catch (e) {}
        }
      }
    }

    console.log('\n--- ALL USERS IN COACHING DB (FIRST 20) ---');
    const allRes = await client.query(`SELECT id, email, full_name, role::text as role_str, created_at, updated_at FROM users LIMIT 20`);
    console.log(allRes.rows);

  } catch (err) {
    console.error('Coaching DB Error:', err);
  } finally {
    await client.end();
  }
}

run();
