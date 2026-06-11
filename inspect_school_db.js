const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function inspect() {
  const connectionString = process.env.SCHOOL_DB_URL;
  if (!connectionString) {
    console.error('SCHOOL_DB_URL not found in .env');
    return;
  }
  
  console.log('Connecting to:', connectionString.replace(/:([^:@]+)@/, ':****@'));
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // List tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('\n--- TABLES ---');
    tablesRes.rows.forEach(r => console.log(r.table_name));

    // Inspect timetables columns
    const columnsRes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'timetables'
      ORDER BY ordinal_position;
    `);
    console.log('\n--- TIMETABLES COLUMNS ---');
    columnsRes.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`));

  } catch (err) {
    console.error('Error during inspection:', err);
  } finally {
    await client.end();
  }
}

inspect();
