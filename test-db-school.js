const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");
    
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'study_materials'
    `);
    
    console.log("study_materials columns:");
    res.rows.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type}`);
    });
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
