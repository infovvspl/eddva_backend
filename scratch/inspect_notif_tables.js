const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const tables = [
    'assignments',
    'assignment_submissions',
    'assessments',
    'results',
    'study_materials',
    'users',
    'students',
    'teachers',
    'timetables',
    'attendances',
    'sections',
    'classes'
  ];
  const res = await client.query(`
    SELECT id, title, type, user_id, recipient_id, is_read, role
    FROM notifications 
    ORDER BY created_at DESC 
    LIMIT 10;
  `);
  res.rows.forEach(r => {
    console.log(`Notif: ${r.title} | User: ${r.user_id} | Recipient: ${r.recipient_id} | Read: ${r.is_read} | Role: ${r.role}`);
  });
  await client.end();
}

run().catch(console.error);
