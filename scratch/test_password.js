const { Client } = require('pg');
const bcrypt = require('bcryptjs') || require('bcrypt');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`SELECT id, email, password, role FROM users WHERE role = 'SUPER_ADMIN' OR email ILIKE '%superadmin%'`);
  console.log('Superadmin users:', res.rows);

  for (const user of res.rows) {
    console.log(`Checking user ${user.email}:`);
    const passwordsToTest = ['Admin@123', 'admin@123', 'admin', '123456', 'superadmin', 'Superadmin@123', '123'];
    for (const pwd of passwordsToTest) {
      try {
        const match = await bcrypt.compare(pwd, user.password);
        if (match) {
          console.log(`  MATCH FOUND! Password is: "${pwd}"`);
        }
      } catch (err) {
        console.error('  Bcrypt error:', err.message);
      }
    }
  }

  await client.end();
}

run().catch(console.error);
