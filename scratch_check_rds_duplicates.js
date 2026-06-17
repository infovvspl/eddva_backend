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
      SELECT LOWER(TRIM(name)) as name, COUNT(*) as count 
      FROM subjects 
      GROUP BY LOWER(TRIM(name))
      HAVING COUNT(*) > 1
    `);
    console.log("Duplicate subjects in school DB:");
    console.log(res.rows);

    const allRes = await client.query(`
      SELECT id, name, class_id, section_id FROM subjects ORDER BY name
    `);
    console.log("All subjects:");
    console.log(JSON.stringify(allRes.rows, null, 2));

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
