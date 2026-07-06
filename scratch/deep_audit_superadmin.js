const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('--- ALL TABLES IN DB ---');
  const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  console.log(tablesRes.rows.map(r => r.table_name).join(', '));

  console.log('\n--- SEARCHING FOR "superadmin" IN ALL USER/AUDIT TABLES ---');
  // Check users columns
  const usersCols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users'`);
  console.log('User table columns:', usersCols.rows.map(r => r.column_name).join(', '));

  const allUsers = await client.query(`SELECT * FROM users WHERE email LIKE '%superadmin%' OR role LIKE '%SUPER%' OR name LIKE '%Super%'`);
  console.log('\nMatching users in DB:', allUsers.rows);

  // Check audit_logs table if it exists
  const hasAudit = tablesRes.rows.some(r => r.table_name.includes('audit'));
  if (hasAudit) {
    console.log('\nChecking audit table...');
    const auditRes = await client.query(`SELECT * FROM audit_logs WHERE action LIKE '%USER%' OR details LIKE '%superadmin%' ORDER BY created_at DESC LIMIT 10`);
    console.log('Audit records:', auditRes.rows);
  }

  await client.end();
}

run().catch(console.error);
