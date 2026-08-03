const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const students = await client.query(`
    SELECT s.user_id, s.id, s.parent_email, s.parent_phone, u.name
    FROM students s
    INNER JOIN users u ON s.user_id = u.id
    LIMIT 3
  `);
  console.log('STUDENTS:', students.rows);

  const assessments = await client.query(`
    SELECT id, title, tenant_id FROM assessments LIMIT 3
  `);
  console.log('ASSESSMENTS:', assessments.rows);

  const parentUsers = await client.query(`
    SELECT id, name, email, phone FROM users WHERE role = 'PARENT' LIMIT 3
  `);
  console.log('PARENTS:', parentUsers.rows);

  await client.end();
}

run().catch(console.error);
