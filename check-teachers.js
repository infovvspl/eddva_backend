const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Get the most recently logged in teacher
    const res = await client.query(`SELECT id, email, last_login_at FROM users WHERE role = 'TEACHER' ORDER BY last_login_at DESC NULLS LAST LIMIT 5`);
    console.log("Recently Logged-in Teachers:");
    res.rows.forEach(r => {
      console.log(`${r.id} | ${r.email} | Last Login: ${r.last_login_at}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
