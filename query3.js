const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  const res = await client.query(`SELECT * FROM teacher_academic_assignments LIMIT 5`);
  console.log("Any Assignments:", res.rows);

  const res2 = await client.query(`SELECT id, name, role FROM users WHERE role = 'TEACHER'`);
  console.log("Teachers:", res2.rows);

  await client.end();
}
run().catch(console.error);
