const { Client } = require('pg');

async function checkEventsTable() {
  const schoolUrl = "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new Client({ connectionString: schoolUrl });
  try {
    await client.connect();
    
    console.log("--- Events Columns ---");
    const colRes = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='events'");
    console.log(colRes.rows);

    console.log("\n--- Sample Events ---");
    const sampleRes = await client.query("SELECT * FROM events LIMIT 5");
    console.log(sampleRes.rows);
  } catch (err) {
    console.error("Error querying school DB:", err);
  } finally {
    await client.end();
  }
}

checkEventsTable();
