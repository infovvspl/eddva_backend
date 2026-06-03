const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  const res = await client.query(`SELECT * FROM teachers WHERE id = '15f29a6d-2215-4f7c-b4ce-49d92104c28f'`);
  console.log("Teachers Table:", res.rows);
  const res2 = await client.query(`SELECT * FROM users WHERE id = '15f29a6d-2215-4f7c-b4ce-49d92104c28f'`);
  console.log("Users Table:", res2.rows);
  await client.end();
}
run().catch(console.error);
