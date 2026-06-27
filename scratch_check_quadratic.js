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
      WHERE description LIKE '%discriminant is given by%'
      LIMIT 1
    `);
    
    if (res.rows.length > 0) {
      console.log("Found material:", res.rows[0].title);
      console.log("Raw Description:\n", res.rows[0].description);
    } else {
      console.log("No matching material found");
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
