const { Client } = require('pg');

async function check() {
  const schoolClient = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await schoolClient.connect();
    console.log("Connected to School DB.");

    const res = await schoolClient.query(`
      SELECT id, recording_id, text, color, deleted_at, created_by 
      FROM class_recording_highlights
    `);
    console.log("All School Recording Highlights (length:", res.rows.length, "):");
    console.log(res.rows);
  } catch (err) {
    console.error("School DB Error:", err);
  } finally {
    await schoolClient.end();
  }
}

check();
