const { Client } = require('pg');
const bcrypt = require('bcryptjs') || require('bcrypt');
require('dotenv').config();

async function activateCoachingDb() {
  console.log('=== ACTIVATING IN COACHING DB ===');
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res1 = await client.query(`
    UPDATE users
    SET status = 'active', updated_at = NOW()
    WHERE email = 'superadmin@gmail.com'
    RETURNING id, email, role, status;
  `);
  console.log('Activated superadmin@gmail.com in Coaching DB:', res1.rows);

  const res2 = await client.query(`
    UPDATE users
    SET status = 'active', updated_at = NOW()
    WHERE email = 'admin@edva.in'
    RETURNING id, email, role, status;
  `);
  console.log('Activated admin@edva.in in Coaching DB:', res2.rows);

  await client.end();
}

async function activateSchoolDb() {
  console.log('\n=== ACTIVATING/SEEDING IN SCHOOL DB ===');
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  const check = await client.query(`SELECT id FROM users WHERE email = 'superadmin@gmail.com'`);
  if (check.rows.length > 0) {
    const res = await client.query(`
      UPDATE users
      SET password = $1, role = 'SUPER_ADMIN', updated_at = NOW()
      WHERE email = 'superadmin@gmail.com'
      RETURNING id, email, role;
    `, [hashedPassword]);
    console.log('Updated superadmin@gmail.com in School DB:', res.rows);
  } else {
    const res = await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('Super Admin', 'superadmin@gmail.com', $1, 'SUPER_ADMIN')
      RETURNING id, email, role;
    `, [hashedPassword]);
    console.log('Created superadmin@gmail.com in School DB:', res.rows);
  }

  await client.end();
}

async function run() {
  await activateCoachingDb();
  await activateSchoolDb();
  console.log('\nSUCCESS: Superadmin accounts active in both databases!');
}

run().catch(console.error);
