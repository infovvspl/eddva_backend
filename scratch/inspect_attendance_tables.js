const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const tables = ['attendances', 'attendance_sessions', 'attendance_records', 'students', 'sections', 'classes', 'subjects'];
  for (const table of tables) {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);
    console.log(`\nTable: ${table}`);
    res.rows.forEach(r => {
      console.log(` - ${r.column_name}: ${r.data_type}`);
    });
  }
  await client.end();
}

run().catch(console.error);
