const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    const subjectsRes = await client.query(`SELECT id, name, class_id, institute_id FROM subjects LIMIT 20`);
    console.log("Subjects:");
    console.log(JSON.stringify(subjectsRes.rows, null, 2));

    const chaptersRes = await client.query(`SELECT id, name, subject_id, sort_order FROM chapters LIMIT 20`);
    console.log("Chapters:");
    console.log(JSON.stringify(chaptersRes.rows, null, 2));
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
