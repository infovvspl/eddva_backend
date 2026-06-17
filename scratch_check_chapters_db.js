const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    const chapters = await client.query(`
      SELECT c.id as chapter_id, c.name as chapter_name, c.subject_id, s.name as subject_name, s.class_id
      FROM chapters c
      LEFT JOIN subjects s ON c.subject_id = s.id
      ORDER BY s.name, c.name
    `);
    console.log("Chapters list with subject name:");
    console.log(JSON.stringify(chapters.rows, null, 2));

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
