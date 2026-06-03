const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  const res = await client.query(`SELECT id, name FROM users WHERE name ILIKE '%Pratap Kumar Das%'`);
  console.log("Teacher:", res.rows);
  if (res.rows.length > 0) {
    const res2 = await client.query(`SELECT id, name, class_name, section_name FROM subjects WHERE name ILIKE '%Math%' AND class_name ILIKE '%1%'`);
    console.log("Subjects:", res2.rows);
    const res3 = await client.query(`SELECT * FROM teacher_academic_assignments WHERE teacher_id = $1`, [res.rows[0].id]);
    console.log("Assignments:", res3.rows);
  }
  await client.end();
}
run().catch(console.error);
