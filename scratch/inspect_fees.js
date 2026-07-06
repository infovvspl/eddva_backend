const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    const res = await client.query(`SELECT COUNT(*)::int AS count FROM fees`);
    console.log("Total fees count:", res.rows[0].count);

    if (res.rows[0].count > 0) {
      const sample = await client.query(`SELECT * FROM fees LIMIT 5`);
      console.log("Sample fees rows:", sample.rows);
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
