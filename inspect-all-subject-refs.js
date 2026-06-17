const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const query = `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name LIKE '%subject%' OR column_name = 'subject')
    ORDER BY table_name, column_name
  `;
  const res = await client.query(query);
  console.log('ALL TABLES WITH SUBJECT REFERENCES IN SCHOOL DB:');
  console.log(res.rows.map(r => `  ${r.table_name}.${r.column_name} (${r.data_type})`).join('\n'));

  await client.end();
}

run().catch(console.error);
