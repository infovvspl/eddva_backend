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
      WHERE id = '107991cc-77d9-42d5-ab51-af4a7cfa47e5'
    `);
    
    if (res.rows.length > 0) {
      const row = res.rows[0];
      console.log("ID:", row.id);
      console.log("Title:", row.title);
      console.log("Description Raw:");
      console.log(JSON.stringify(row.description));
      console.log("\nDescription Text:\n", row.description);
    } else {
      console.log("Material not found");
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
