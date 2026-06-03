const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});
async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT ta.*, u.name as teacher_name, sub.name as subject_name, c.name as class_name, s.name as section_name
    FROM teacher_academic_assignments ta
    JOIN users u ON ta.teacher_id = u.id
    LEFT JOIN subjects sub ON ta.subject_id = sub.id
    LEFT JOIN classes c ON ta.class_id = c.id
    LEFT JOIN sections s ON ta.section_id = s.id
    WHERE sub.name ILIKE '%Math%'
  `);
  console.log("Math Assignments:", res.rows);
  await client.end();
}
run().catch(console.error);
