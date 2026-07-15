const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB");

    const res = await client.query(`
      SELECT COUNT(*) AS count FROM audit_logs
    `);
    console.log("Total audit logs:", res.rows[0].count);

    const sample = await client.query(`
      SELECT module, action, description, created_at FROM audit_logs LIMIT 5
    `);
    console.log("Sample:", sample.rows);

  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await client.end();
  }
}

run();
