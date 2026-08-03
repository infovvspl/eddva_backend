const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const tables = ['assessments', 'results', 'assignments', 'assignment_submissions', 'students', 'teachers', 'users'];
    for (const t of tables) {
      const res = await client.query(
        `SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_name = $1 
         ORDER BY column_name`,
        [t]
      );
      console.log(`\nTable: ${t}`);
      console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
