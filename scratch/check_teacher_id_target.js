const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const id = '911eeb3d-60ce-4ba5-b476-9c0b975b666b';
  const t = await client.query(`SELECT id, user_id FROM teachers WHERE id = $1`, [id]);
  console.log('TEACHERS MATCH:', t.rows);

  const u = await client.query(`SELECT id, role FROM users WHERE id = $1`, [id]);
  console.log('USERS MATCH:', u.rows);

  await client.end();
}

run().catch(console.error);
