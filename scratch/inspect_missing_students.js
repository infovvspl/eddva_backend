const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const missing = ['263a9194-6105-4620-8af0-04c3ed45025c', '908af90c-34e3-42a2-bd62-80693f0aeadc'];
    for (const id of missing) {
      const res = await client.query("SELECT * FROM students WHERE id = $1", [id]);
      console.log(`Student ${id}:`, res.rows[0]);
      if (res.rows[0]) {
        const userRes = await client.query("SELECT * FROM users WHERE id = $1", [res.rows[0].user_id]);
        console.log(`User for ${id}:`, userRes.rows[0]);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
