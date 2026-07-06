const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('--- COACHING DB TABLES ---');
  const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  console.log(tablesRes.rows.map(r => r.table_name).join(', '));

  // Check audit_logs or user_logs or logs tables
  const logTables = tablesRes.rows.filter(r => r.table_name.includes('log') || r.table_name.includes('audit'));
  console.log('Log tables:', logTables);

  for (const t of logTables) {
    try {
      const logs = await client.query(`SELECT * FROM ${t.table_name} ORDER BY created_at DESC LIMIT 10`);
      console.log(`\nLogs in ${t.table_name}:`, logs.rows);
    } catch (e) {
      console.error(`Error reading ${t.table_name}:`, e.message);
    }
  }

  await client.end();
}

run();
