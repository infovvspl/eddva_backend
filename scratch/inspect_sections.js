const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('=== COLUMNS FOR sections ===');
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'sections'
    ORDER BY ordinal_position;
  `);
  console.table(cols.rows);

  console.log('=== CONSTRAINTS FOR sections ===');
  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'sections'::regclass;
  `);
  console.table(cons.rows);

  console.log('=== ALL ROWS IN sections ===');
  const rows = await client.query('SELECT id, class_id, name, academic_year FROM sections');
  console.table(rows.rows);

  await client.end();
}

run().catch(console.error);
