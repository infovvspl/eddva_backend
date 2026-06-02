const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const tables = ['teachers', 'teacher_classes', 'teacher_sections', 'teacher_subjects', 'sections', 'subjects', 'activity_logs'];
  for (const table of tables) {
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `, [table]);
    console.log(`\nTable ${table}:`);
    console.table(res.rows);
  }
  await client.end();
}

run().catch(console.error);
