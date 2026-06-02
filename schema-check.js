const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
async function run() {
  await c.connect();
  for (const t of ['teachers', 'classes', 'sections', 'subjects', 'teacher_subjects', 'teacher_sections']) {
    try {
      const res = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}'`);
      console.log(`Table: ${t}`);
      console.log(res.rows);
    } catch(e) {}
  }
  await c.end();
}
run();
