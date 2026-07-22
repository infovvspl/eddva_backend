const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Running database constraint migration for classes...');

  // 1. Drop old constraint
  await client.query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_institute_id_name_key;`);
  await client.query(`DROP INDEX IF EXISTS classes_institute_id_name_key;`);

  // 2. Backfill null academic_year if any
  await client.query(`UPDATE classes SET academic_year = '2025-2026' WHERE academic_year IS NULL OR TRIM(academic_year) = '';`);

  // 3. Add new composite constraint
  await client.query(`
    ALTER TABLE classes
    DROP CONSTRAINT IF EXISTS classes_institute_id_academic_year_name_key;
  `);

  await client.query(`
    ALTER TABLE classes
    ADD CONSTRAINT classes_institute_id_academic_year_name_key
    UNIQUE (institute_id, academic_year, name);
  `);

  console.log('Migration executed successfully!');

  // Inspect new constraints
  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 'classes'::regclass;
  `);
  console.table(cons.rows);

  await client.end();
}

run().catch(console.error);
