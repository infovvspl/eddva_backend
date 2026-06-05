const { Client } = require('pg');

async function checkDb() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    const countRes = await client.query(`SELECT COUNT(*) FROM assessments`);
    console.log("COUNT:", countRes.rows[0].count);

    const rowsRes = await client.query(`SELECT * FROM assessments LIMIT 10`);
    console.log("ROWS:");
    console.log(rowsRes.rows);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

checkDb();
