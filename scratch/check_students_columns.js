const { Client } = require('pg');

async function checkStudentsTable() {
  const schoolUrl = "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new Client({ connectionString: schoolUrl });
  try {
    await client.connect();
    
    console.log("--- Students Columns ---");
    const colRes = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='students'");
    console.log(colRes.rows);
  } catch (err) {
    console.error("Error querying school DB:", err);
  } finally {
    await client.end();
  }
}

checkStudentsTable();
