const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log("Columns in audit_logs:");
  const colRes = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs'");
  console.log(colRes.rows.map(r => r.column_name));

  console.log(`Checking audit logs:`);
  const res = await c.query(`
    SELECT created_at, action, description
    FROM audit_logs
    WHERE description LIKE '%Pratap%' OR description LIKE '%3d0eabde%'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log("Audit Logs:", JSON.stringify(res.rows, null, 2));

  await c.end();
}
run();
