const { Client } = require('pg');
require('dotenv').config();

async function run() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'not set');
  console.log('SCHOOL_DB_URL:', process.env.SCHOOL_DB_URL ? 'set' : 'not set');

  const urls = [
    { name: 'DATABASE_URL', url: process.env.DATABASE_URL },
    { name: 'SCHOOL_DB_URL', url: process.env.SCHOOL_DB_URL },
  ].filter(u => u.url);

  for (const item of urls) {
    console.log(`\n=== Checking ${item.name} ===`);
    const client = new Client({ connectionString: item.url, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%user%'`);
      console.log('User tables:', tables.rows.map(r => r.table_name));

      const users = await client.query(`SELECT id, email, role FROM users LIMIT 20`);
      console.log('Users in table "users":', users.rows);
    } catch (e) {
      console.error(`Error with ${item.name}:`, e.message);
    } finally {
      await client.end();
    }
  }
}

run().catch(console.error);
