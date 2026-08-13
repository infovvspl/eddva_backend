const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.SCHOOL_DB_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    const subjectsRes = await client.query(`SELECT id, name, class_id, institute_id FROM subjects`);
    console.log("Subjects:");
    console.log(JSON.stringify(subjectsRes.rows, null, 2));

    const chaptersRes = await client.query(`SELECT id, name, subject_id, sort_order FROM chapters`);
    console.log("Chapters:");
    console.log(JSON.stringify(chaptersRes.rows, null, 2));
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
