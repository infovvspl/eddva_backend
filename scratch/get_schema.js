const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const getCols = async (table) => {
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = $1;
    `, [table]);
    return res.rows.map(r => r.column_name);
  };
  
  const teachersCols = await getCols('teachers');
  const studentsCols = await getCols('students');
  
  console.log('Teachers columns:', teachersCols);
  console.log('Students columns:', studentsCols);
  
  await client.end();
}
run().catch(console.error);
