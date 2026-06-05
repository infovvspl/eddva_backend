const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('Altering attendance_sessions table...');
  await client.query(`
    ALTER TABLE attendance_sessions 
    ADD COLUMN IF NOT EXISTS section_id uuid,
    ADD COLUMN IF NOT EXISTS period varchar,
    ADD COLUMN IF NOT EXISTS finalized boolean DEFAULT false;
  `);

  console.log('Columns added successfully.');

  // Let's print out the updated columns
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'attendance_sessions'
  `);
  res.rows.forEach(r => {
    console.log(` - ${r.column_name}: ${r.data_type}`);
  });

  await client.end();
}

run().catch(console.error);
