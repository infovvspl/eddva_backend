const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    const resSub = await client.query(`
      SELECT answers_json, answer_text, grading_details 
      FROM assessment_submissions 
      WHERE student_user_id::text = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54'
        AND assessment_id::text = '73503dc7-dc3a-4d84-a7dc-c39ba7243d00'
    `);
    const sub = resSub.rows[0];
    console.log("ANSWERS JSON:", JSON.stringify(sub.answers_json, null, 2));
    console.log("ANSWER TEXT:", sub.answer_text);

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
