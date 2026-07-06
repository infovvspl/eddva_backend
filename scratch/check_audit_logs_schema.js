const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Check columns of audit_logs
    const columns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'audit_logs'
    `);
    console.log("Audit Logs columns:", columns.rows);

    // List some rows of audit_logs where action = 'Login'
    const rows = await client.query("SELECT * FROM audit_logs WHERE action = 'Login' LIMIT 5");
    console.log("Some Login audit logs:", rows.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
