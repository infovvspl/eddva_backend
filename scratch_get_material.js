const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const res = await client.query("SELECT id, title, type, description FROM study_materials WHERE type IN ('dpp','pyq') LIMIT 3");
    for (const row of res.rows) {
      console.log("====================================");
      console.log("Title:", row.title, "Type:", row.type);
      console.log("Content Preview:\n", row.description);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
