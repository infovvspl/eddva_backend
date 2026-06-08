const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database...');

  const tenants = await client.query(`SELECT id, name FROM tenants LIMIT 5;`);
  console.log('--- TENANTS ---');
  tenants.rows.forEach(t => console.log(`ID: ${t.id}, Name: ${t.name}`));

  const institutes = await client.query(`SELECT id, name FROM institutes LIMIT 5;`);
  console.log('--- INSTITUTES ---');
  institutes.rows.forEach(i => console.log(`ID: ${i.id}, Name: ${i.name}`));

  await client.end();
}

run().catch(console.error);
