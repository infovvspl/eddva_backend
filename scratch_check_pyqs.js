const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    const res = await client.query(`
      SELECT id, title, type, description 
      FROM study_materials 
      WHERE type = 'pyq' AND (description LIKE '%A.%' OR description LIKE '%A\\n%')
      LIMIT 3
    `);
    
    for (const row of res.rows) {
      console.log("====================================");
      console.log("ID:", row.id);
      console.log("Title:", row.title);
      console.log("Description:", row.description);
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
