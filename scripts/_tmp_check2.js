require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const r = await client.query(`SELECT COUNT(*)::int AS c, MIN(date) AS min_d, MAX(date) AS max_d FROM teacher_attendance`);
  console.log('teacher_attendance total rows:', r.rows[0]);
  const byMethod = await client.query(`SELECT method, COUNT(*)::int AS c FROM teacher_attendance GROUP BY method`);
  console.log('by method:', byMethod.rows);
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
