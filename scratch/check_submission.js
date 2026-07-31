const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    // 1. Get submission
    const resSub = await client.query(`
      SELECT id, student_user_id, assessment_id, file_path, answers_json, grading_details, grading_status 
      FROM assessment_submissions 
      WHERE student_user_id::text = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'
        AND assessment_id::text = '73503dc7-dc3a-4d84-a7dc-c39ba7243d00'
    `);
    console.log("SUBMISSION ROW:", JSON.stringify(resSub.rows[0], null, 2));

    // 2. Get student's institute
    const resStudent = await client.query(`
      SELECT id, user_id, institute_id FROM students WHERE user_id::text = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'
    `);
    console.log("STUDENT ROW:", JSON.stringify(resStudent.rows[0], null, 2));

    if (resStudent.rows[0]) {
      const instId = resStudent.rows[0].institute_id;
      const resInst = await client.query(`
        SELECT id, name, ai_enabled, ai_features FROM institutes WHERE id::text = $1::text
      `, [instId]);
      console.log("INSTITUTE ROW:", JSON.stringify(resInst.rows[0], null, 2));
    }

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
