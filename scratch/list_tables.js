const { Client } = require('pg');

async function listTables() {
  const schoolUrl = "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new Client({ connectionString: schoolUrl });
  try {
    await client.connect();
    
    console.log("--- Tables ---");
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public'
      ORDER BY table_name
    `);
    console.log(res.rows.map(r => r.table_name));
  } catch (err) {
    console.error("Error querying school DB:", err);
  } finally {
    await client.end();
  }
}

listTables();
