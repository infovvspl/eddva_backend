const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  const res = await client.query(`SELECT id, name FROM users WHERE name ILIKE '%Pratap Kumar Das%'`);
  console.log("Teacher:", res.rows);
  if (res.rows.length > 0) {
    const res3 = await client.query(`SELECT * FROM teacher_academic_assignments WHERE teacher_id = $1`, [res.rows[0].id]);
    console.log("Assignments for teacher:", res3.rows);

    if (res3.rows.length > 0) {
      for (const row of res3.rows) {
        const res4 = await client.query(`SELECT * FROM subjects WHERE id = $1`, [row.subject_id]);
        console.log("Subject mapped:", res4.rows);
      }
    }
  }
  await client.end();
}
run().catch(console.error);
