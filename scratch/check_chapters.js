const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  await c.connect();
  
  // 1. Check chapters table schema
  console.log('=== CHAPTERS TABLE SCHEMA ===');
  const schema = await c.query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='chapters' ORDER BY ordinal_position`);
  console.log(JSON.stringify(schema.rows, null, 2));
  
  // 2. Check teacher_academic_assignments table
  console.log('\n=== TEACHER_ACADEMIC_ASSIGNMENTS TABLE ===');
  const taa = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='teacher_academic_assignments' ORDER BY ordinal_position`);
  console.log(JSON.stringify(taa.rows, null, 2));
  
  // 3. Check existing chapters
  console.log('\n=== EXISTING CHAPTERS ===');
  const chapters = await c.query(`SELECT * FROM chapters LIMIT 5`);
  console.log(JSON.stringify(chapters.rows, null, 2));
  
  // 4. Check existing subjects
  console.log('\n=== EXISTING SUBJECTS (first 5) ===');
  const subjects = await c.query(`SELECT id, name, institute_id FROM subjects LIMIT 5`);
  console.log(JSON.stringify(subjects.rows, null, 2));
  
  // 5. Check teacher_academic_assignments
  console.log('\n=== EXISTING TEACHER ASSIGNMENTS (first 5) ===');
  const assigns = await c.query(`SELECT * FROM teacher_academic_assignments LIMIT 5`);
  console.log(JSON.stringify(assigns.rows, null, 2));
  
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
