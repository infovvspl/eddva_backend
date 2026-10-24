require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const created = await client.query(`SELECT MIN(created_at) AS min_c, MAX(created_at) AS max_c FROM teacher_attendance`);
  console.log('created_at range:', created.rows[0]);
  const teachers = await client.query(`SELECT COUNT(*)::int AS c FROM teachers WHERE institute_id = 'c259cd4e-b018-45e2-8e46-52a497ca49a1'`);
  console.log('teacher count at Eddva School:', teachers.rows[0]);
  const sample = await client.query(`SELECT teacher_user_id, date, status, method, check_in_time, created_at FROM teacher_attendance ORDER BY created_at DESC LIMIT 5`);
  console.log('most recent rows:', sample.rows);
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
