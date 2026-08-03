const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const res = await c.query('SELECT user_id, documents, qualifications, nationality, dob, gender, joining_date FROM teachers');
  console.log(`Found ${res.rows.length} teachers in database. Checking for null flat columns...`);

  for (const row of res.rows) {
    const docs = row.documents || {};
    const details = docs.teacherDetails || {};
    if (Object.keys(details).length === 0) continue;

    const updates = [];
    const params = [row.user_id];

    const valOrNull = (val) => val || null;

    if (!row.qualifications && (details.qualification || details.degree || details.specialization)) {
      const qStr = [details.qualification, details.degree, details.specialization].filter(Boolean).join(' | ');
      if (qStr) {
        params.push(qStr);
        updates.push(`qualifications = $${params.length}`);
      }
    }
    if (!row.nationality && details.nationality) {
      params.push(details.nationality);
      updates.push(`nationality = $${params.length}`);
    }
    if (!row.gender && details.gender) {
      params.push(details.gender);
      updates.push(`gender = $${params.length}`);
    }
    if (!row.dob && details.dob) {
      params.push(new Date(details.dob));
      updates.push(`dob = $${params.length}`);
    }
    if (!row.joining_date && details.joiningDate) {
      params.push(new Date(details.joiningDate));
      updates.push(`joining_date = $${params.length}`);
    }

    if (updates.length > 0) {
      console.log(`Restoring fields for user ${row.user_id}:`, updates);
      await c.query(`UPDATE teachers SET ${updates.join(', ')} WHERE user_id = $1`, params);
    }
  }

  console.log("All teacher details restoration checked!");
  await c.end();
}
run();
