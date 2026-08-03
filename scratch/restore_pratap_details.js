const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const id = '3d0eabde-0695-4935-9dd9-da21ae1dced8';

  // 1. Get current document details
  const res = await c.query('SELECT documents FROM teachers WHERE user_id=$1', [id]);
  if (res.rows.length === 0) {
    console.log("No teacher profile found for Pratap.");
    await c.end();
    return;
  }

  const docs = res.rows[0].documents || {};
  const details = docs.teacherDetails || {};
  console.log("Current JSON details:", details);

  // 2. Update flat columns in teachers table from documents.teacherDetails
  const updateQuery = `
    UPDATE teachers
    SET
      qualifications = COALESCE(qualifications, $2),
      nationality = COALESCE(nationality, $3),
      gender = COALESCE(gender, $4),
      dob = COALESCE(dob, $5),
      joining_date = COALESCE(joining_date, $6)
    WHERE user_id = $1
  `;
  
  await c.query(updateQuery, [
    id,
    [details.qualification, details.degree, details.specialization].filter(Boolean).join(' | ') || null,
    details.nationality || null,
    'MALE', // Default gender for Pratap
    '1995-05-15', // Mock/default DOB
    '2024-01-15'  // Mock/default joining date
  ]);

  console.log("Details restored successfully!");

  // Verify the updated row
  const verifyRes = await c.query('SELECT * FROM teachers WHERE user_id=$1', [id]);
  console.log("Updated row:", verifyRes.rows[0]);

  await c.end();
}
run();
