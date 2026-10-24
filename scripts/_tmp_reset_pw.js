require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
(async () => {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const hash = await bcrypt.hash('Student@123', 12);
  await client.query(`UPDATE users SET password = $1 WHERE id = '4d0a20b9-a912-4fa8-aa29-949c978c3b3f'`, [hash]);
  console.log('Password reset for Rahul Sahu (demo/seeded account)');
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
