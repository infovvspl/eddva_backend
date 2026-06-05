const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log('--- FOREIGN KEYS ON attendance_sessions ---');
  const fks = await client.query(`
    SELECT
      tc.table_schema, 
      tc.constraint_name, 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_schema AS foreign_table_schema,
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
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'attendance_sessions';
  `);
  console.log(fks.rows);

  console.log('\n--- TENANTS IN DATABASE ---');
  const tenants = await client.query('SELECT * FROM tenants LIMIT 5');
  console.log(tenants.rows);

  console.log('\n--- INSTITUTES IN DATABASE ---');
  const institutes = await client.query('SELECT * FROM institutes LIMIT 5');
  console.log(institutes.rows);

  await client.end();
}

run().catch(console.error);
