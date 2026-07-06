const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('=== COLUMNS FOR classes ===');
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'classes'
    ORDER BY ordinal_position;
  `);
  console.table(cols.rows);

  console.log('=== CONSTRAINTS FOR classes ===');
  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'classes'::regclass;
  `);
  console.table(cons.rows);

  console.log('=== INDEXES FOR classes ===');
  const idxs = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'classes';
  `);
  console.table(idxs.rows);

  console.log('=== ALL ROWS IN classes ===');
  const rows = await client.query('SELECT id, institute_id, name, academic_year FROM classes');
  console.table(rows.rows);

  console.log('=== ACADEMIC YEARS TABLE IF EXISTS ===');
  try {
    const ay = await client.query('SELECT * FROM academic_years');
    console.table(ay.rows);
  } catch (e) {
    console.log('academic_years table query result:', e.message);
  }

  await client.end();
}

run().catch(console.error);
