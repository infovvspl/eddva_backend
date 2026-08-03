const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const roles = ['TEACHER', 'PARENT', 'INSTITUTE_ADMIN', 'SUPER_ADMIN'];
  for (const r of roles) {
    const res = await client.query(`SELECT id, name, email, role FROM users WHERE role = $1 AND is_active = true LIMIT 1`, [r]);
    console.log(`USER OF ROLE ${r}:`, res.rows[0]);
  }
  await client.end();
}

run().catch(console.error);
