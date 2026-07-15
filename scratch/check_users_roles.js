const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB");

    const usersRes = await client.query(`SELECT id, name, email, role, institute_id FROM users WHERE role IN ('TEACHER', 'INSTITUTE_ADMIN') LIMIT 30`);
    console.log("Users and Roles:");
    console.log(JSON.stringify(usersRes.rows, null, 2));

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
