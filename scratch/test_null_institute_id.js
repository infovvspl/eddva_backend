const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const instituteId = null;
  const todayStr = '2026-07-06';

  try {
    console.log('Testing instituteId = null queries...');
    await client.query(`SELECT * FROM institutes WHERE id=$1`, [instituteId]);
  } catch (err) {
    console.error('ERROR 1:', err.message);
  }

  try {
    await client.query(`SELECT COUNT(*)::int AS c FROM users WHERE role='TEACHER' AND institute_id=$1`, [instituteId]);
  } catch (err) {
    console.error('ERROR 2:', err.message);
  }

  try {
    await client.query(`
      SELECT COUNT(DISTINCT ar.student_id)::int AS present
      FROM attendance_records ar
      JOIN attendance_sessions asess ON ar.session_id = asess.id
      WHERE asess.tenant_id = $1 AND asess.date = $2
        AND (LOWER(ar.status) IN ('present', 'late', 'half_day', 'half-day', 'halfday') OR LOWER(ar.status) LIKE 'half%')
    `, [instituteId, todayStr]);
    console.log('Attendance Query SUCCESS');
  } catch (err) {
    console.error('ERROR 3 (attendance query):', err.message);
  }

  await client.end();
}

run();
