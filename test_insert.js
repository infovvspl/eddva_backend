const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  try {
    await client.query(
      `INSERT INTO chapters (subject_id, institute_id, name, description, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      ['6bda44a0-0523-42cc-90f6-97e50286b91e', null, 'Test Chapter', null, 0]
    );
    console.log("Insert successful!");
  } catch (e) {
    console.error("DB Error:", e.message);
  }
  await client.end();
}
run();
