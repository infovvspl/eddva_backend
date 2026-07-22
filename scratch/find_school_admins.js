const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT id, email, name, role, institute_id, is_active
    FROM users
    WHERE role = 'INSTITUTE_ADMIN' OR role = 'TEACHER';
  `);

  console.log('School admins & teachers:', res.rows);
  await client.end();
}

run();
