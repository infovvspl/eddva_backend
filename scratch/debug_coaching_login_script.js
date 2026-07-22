const { Client } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const users = await client.query(`SELECT id, email, password, role, status FROM users WHERE email IN ('superadmin@gmail.com', 'admin@edva.in')`);
  console.log('Users in Coaching DB:', users.rows);

  for (const u of users.rows) {
    console.log(`\nTesting user ${u.email}:`);
    console.log('Password hash in DB:', u.password);
    console.log('Role in DB:', u.role);
    console.log('Status in DB:', u.status);

    const match1 = await bcrypt.compare('Admin@123', u.password);
    console.log('Match with "Admin@123":', match1);

    const match2 = await bcrypt.compare('change_this_in_production', u.password);
    console.log('Match with "change_this_in_production":', match2);
  }

  await client.end();
}

run();
