const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB.");

    const admins = await client.query("SELECT id, name, email, role, institute_id FROM users WHERE role IN ('ADMIN', 'SCHOOL_ADMIN', 'INSTITUTE_ADMIN') LIMIT 5");
    console.log("Admins:", admins.rows);

  } catch (err) {
    console.error("DB error:", err);
  } finally {
    await client.end();
  }
}
run();
