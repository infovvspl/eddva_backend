const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    console.log("Searching logs since local todayStart:", todayStart.toISOString());

    const result = await client.query(`
      SELECT id, description, created_at, ip_address, status
      FROM audit_logs
      WHERE action = 'Login' AND status = 'Failure' AND created_at >= $1
      ORDER BY created_at DESC
    `, [todayStart]);

    console.log("Total failed logins today:", result.rowCount);
    console.log("Sample of today's failed login descriptions:");
    console.log(result.rows.slice(0, 20));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
