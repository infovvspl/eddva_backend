const { Client } = require('pg');
const bcrypt = require('bcryptjs') || require('bcrypt');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`SELECT email, password, status FROM users WHERE email = 'admin@edva.in'`);
  if (res.rows.length > 0) {
    const user = res.rows[0];
    console.log('User found:', user.email, 'Status:', user.status);
    const match = await bcrypt.compare('change_this_in_production', user.password);
    console.log('Password "change_this_in_production" match:', match);
  }

  await client.end();
}

run();
