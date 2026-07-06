const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT *
    FROM users
    WHERE email IN ('superadmin@gmail.com', 'admin@edva.in')
  `);

  console.log('Comparison of both superadmin users:');
  console.log(JSON.stringify(res.rows, null, 2));

  await client.end();
}

run().catch(console.error);
