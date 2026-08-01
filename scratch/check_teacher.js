const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to RDS School DB");

    const resUsers = await client.query(`
      SELECT id, name, email, role, institute_id FROM users WHERE role = 'TEACHER' OR role = 'INSTITUTE_ADMIN'
    `);
    console.log("TEACHERS / ADMINS:", JSON.stringify(resUsers.rows, null, 2));

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
