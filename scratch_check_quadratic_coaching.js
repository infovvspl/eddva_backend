const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgres://postgres.utiqzdnyrrprcdghqkgv:Subham%40123%40@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to Coaching DB");

    const res = await client.query(`
      SELECT id, title, type, description 
      FROM topic_resources 
      WHERE description LIKE '%discriminant is given by%'
      LIMIT 1
    `);
    
    if (res.rows.length > 0) {
      console.log("Found resource:", res.rows[0].title);
      console.log("Raw Description:\n", res.rows[0].description);
    } else {
      console.log("No matching resource found");
    }
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
