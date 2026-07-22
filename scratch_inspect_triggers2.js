const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log("=== pg_trigger FOR users ===");
    const res = await client.query(`
      SELECT tgname, tgenabled, tgtype 
      FROM pg_trigger 
      WHERE tgrelid = 'users'::regclass
    `);
    console.log(res.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
