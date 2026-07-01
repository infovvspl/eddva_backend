const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB.");

    const res = await client.query(`
      SELECT s.id, u.full_name, u.email, s.updated_at
      FROM students s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.updated_at DESC
      LIMIT 5
    `);
    
    console.log("Most recently updated students:", res.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
