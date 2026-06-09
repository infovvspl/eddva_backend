const { Client } = require('pg');

async function checkDb() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    const assessmentRes = await client.query(
      `SELECT title, questions_json, answer_key FROM assessments WHERE id = $1`,
      ['90d969cf-9e5d-46f6-9fcb-7c98723de378']
    );
    console.log("ASSESSMENT:");
    console.log(JSON.stringify(assessmentRes.rows[0], null, 2));

    const submissionsRes = await client.query(
      `SELECT id, answers_json, grading_details, grading_status, objective_score, objective_total FROM assessment_submissions WHERE assessment_id = $1`,
      ['90d969cf-9e5d-46f6-9fcb-7c98723de378']
    );
    console.log("SUBMISSIONS:");
    console.log(JSON.stringify(submissionsRes.rows, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

checkDb();
