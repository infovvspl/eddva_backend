const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL });
  try {
    await client.connect();
    const res = await client.query(`
      SELECT e.enumlabel 
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'notifications_type_enum' OR t.typname LIKE '%notification%type%';
    `);
    console.log('Enum values:');
    res.rows.forEach(r => console.log(`  ${r.enumlabel}`));
  } catch (err) {
    console.error('Error running check:', err);
  } finally {
    await client.end();
  }
}

run();
