const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const tables = [
    'subjects',
    'teacher_academic_assignments',
    'timetables',
    'assignments',
    'assessments',
    'study_materials',
    'class_subjects',
    'teacher_subjects'
  ];

  for (const table of tables) {
    try {
      const res = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      console.log(`\nTable: ${table}`);
      console.log(res.rows.map(r => `  ${r.column_name}: ${r.data_type} (${r.is_nullable})`).join('\n'));
    } catch (err) {
      console.log(`Failed to inspect table ${table}:`, err.message);
    }
  }

  await client.end();
}

run().catch(console.error);
