const { Client } = require('pg');
require('dotenv').config();

async function run() {
  console.log('--- Checking SCHOOL DB ---');
  const schoolClient = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await schoolClient.connect();
  const schoolRes = await schoolClient.query(`
    SELECT
      tc.constraint_name, 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = 'complaints';
  `);
  console.log('School DB Constraints for complaints:', schoolRes.rows);
  await schoolClient.end();

  console.log('\n--- Checking COACHING DB ---');
  const coachingClient = new Client({ connectionString: process.env.COACHING_DB_URL, ssl: { rejectUnauthorized: false } });
  await coachingClient.connect();
  const coachingRes = await coachingClient.query(`
    SELECT
      tc.constraint_name, 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.table_name = 'complaints';
  `);
  console.log('Coaching DB Constraints for complaints:', coachingRes.rows);
  await coachingClient.end();
}

run().catch(console.error);
