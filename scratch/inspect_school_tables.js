const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});

async function main() {
  try {
    await client.connect();
    
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log("=== TABLES ===");
    tablesRes.rows.forEach(r => console.log(`- ${r.table_name}`));
    
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

main();
