const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('--- attendance_records indexes & constraints ---');
  const res1 = await client.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'attendance_records'
  `);
  console.log(res1.rows);

  const res1_con = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'attendance_records'::regclass
  `);
  console.log(res1_con.rows);

  console.log('\n--- attendances indexes & constraints ---');
  const res2 = await client.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'attendances'
  `);
  console.log(res2.rows);

  const res2_con = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = 'attendances'::regclass
  `);
  console.log(res2_con.rows);

  await client.end();
}

run().catch(console.error);
