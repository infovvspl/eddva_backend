const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database...');

  const searchId = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';

  const tenantMatch = await client.query(`SELECT id, name FROM tenants WHERE id = $1`, [searchId]);
  console.log('Tenant matches:', tenantMatch.rows);

  const instMatch = await client.query(`SELECT id, name FROM public.institutes WHERE id = $1`, [searchId]);
  console.log('Institute matches:', instMatch.rows);

  await client.end();
}

run().catch(console.error);
