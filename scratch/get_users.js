const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database...');

  const users = await client.query(`
    SELECT id, name, email, role, institute_id
    FROM users
    LIMIT 10;
  `);

  console.log('--- USERS IN DB ---');
  users.rows.forEach(u => {
    console.log(`ID: ${u.id}, Name: ${u.name}, Email: ${u.email}, Role: ${u.role}, InstituteID: ${u.institute_id}`);
  });

  await client.end();
}

run().catch(console.error);
