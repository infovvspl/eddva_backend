const { Client } = require('pg');
async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  // 1. teachers table - all columns
  console.log('=== teachers table ===');
  const t = await c.query(`SELECT * FROM teachers`);
  console.log(JSON.stringify(t.rows, null, 2));

  // 2. users where role=TEACHER
  console.log('\n=== users where role=TEACHER ===');
  const u = await c.query(`SELECT id, name, role, phone FROM users WHERE role='TEACHER'`);
  console.log(JSON.stringify(u.rows, null, 2));

  // 3. teacher_academic_assignments teacher_ids
  const taaIds = ['3a357836-2f50-4103-ae43-b31c304a020d','15f29a6d-2215-4f7c-b4ce-49d92104c28f'];
  console.log('\n=== Are these teacher_ids in users table? ===');
  for (const tid of taaIds) {
    const r = await c.query(`SELECT id, role FROM users WHERE id=$1`, [tid]);
    console.log(`  ${tid} in users: ${r.rows.length > 0 ? JSON.stringify(r.rows[0]) : 'NOT FOUND'}`);
    const r2 = await c.query(`SELECT id, user_id FROM teachers WHERE id=$1`, [tid]);
    console.log(`  ${tid} in teachers: ${r2.rows.length > 0 ? JSON.stringify(r2.rows[0]) : 'NOT FOUND'}`);
  }

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
