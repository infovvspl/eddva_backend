const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    // Pratap Das
    const userId = "b49ee8d3-4c33-448c-aa06-30dc8bfbee54";
    const profileId = "39e5bd87-ece0-430d-92a7-4cc94454f65b";

    console.log("\n=== Checking assignment_submissions table ===");
    const res = await client.query(
      `SELECT id, assignment_id, student_id, status, submitted_at, marks FROM assignment_submissions 
       WHERE student_id = $1 OR student_id = $2`,
      [userId, profileId]
    );
    console.log(res.rows);

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
