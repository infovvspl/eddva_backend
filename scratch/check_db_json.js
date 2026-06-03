const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT education_details, experience_details, dob
    FROM teachers
    LIMIT 5;
  `);
  console.log('Returned rows:');
  for (const row of res.rows) {
    console.log('education_details:', typeof row.education_details, row.education_details);
    console.log('experience_details:', typeof row.experience_details, row.experience_details);
    console.log('dob:', typeof row.dob, row.dob);
  }
  await client.end();
}

run().catch(console.error);
