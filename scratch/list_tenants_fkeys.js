const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to School Database...');

  const res = await client.query(`
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
    WHERE ccu.table_name = 'tenants';
  `);

  console.log('--- CONSTRAINTS POINTING TO TENANTS ---');
  res.rows.forEach(r => {
    console.log(`Table: ${r.table_name}, Column: ${r.column_name}, Constraint: ${r.constraint_name} -> referenced table: ${r.foreign_table_name}`);
  });

  await client.end();
}

run().catch(console.error);
