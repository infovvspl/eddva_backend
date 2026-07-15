const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const dbUrl = process.env.COACHING_DB_URL;
  if (!dbUrl) {
    console.error("[Cleanup] COACHING_DB_URL not found in .env at", path.resolve(__dirname, '../.env'));
    return;
  }
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query("SELECT id, name, subdomain FROM tenants WHERE subdomain LIKE 'qa-disp-%'");
    console.log(`[Cleanup] Found ${res.rows.length} disposable test tenants for cleanup.`);
    for (const row of res.rows) {
      console.log(`[Cleanup] Hard-deleting disposable tenant: ${row.name} (${row.subdomain})`);
      // Delete related users first to satisfy foreign key constraint
      await client.query("DELETE FROM users WHERE tenant_id = $1", [row.id]);
      // Hard delete from tenants
      await client.query("DELETE FROM tenants WHERE id = $1", [row.id]);
    }
  } catch (err) {
    console.error("[Cleanup] error:", err);
  } finally {
    await client.end();
  }
}

main();
