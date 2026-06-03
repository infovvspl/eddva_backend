const { Client } = require('pg');
async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  // Drop the wrong FK that points to tenants
  console.log('=== Dropping wrong FK (tenants) ===');
  await c.query(`ALTER TABLE topics DROP CONSTRAINT "FK_44dc6b6f929c6894f621828e915"`);
  console.log('Dropped FK_44dc6b6f929c6894f621828e915 (topics.institute_id -> tenants.id)');

  // Verify remaining FKs
  console.log('\n=== Remaining FKs on topics ===');
  const fks = await c.query(`
    SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'topics' AND tc.constraint_type = 'FOREIGN KEY'
  `);
  console.log(JSON.stringify(fks.rows, null, 2));

  // Test INSERT again
  console.log('\n=== Test INSERT after fix ===');
  try {
    const r = await c.query(
      `INSERT INTO topics (chapter_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      ['38226e46-16eb-4cde-8ab2-31a3ac085c60', 'c259cd4e-b018-45e2-8e46-52a497ca49a1', 'FK Fix Test', 0]
    );
    console.log('SUCCESS:', JSON.stringify(r.rows[0]));
    await c.query(`DELETE FROM topics WHERE id=$1`, [r.rows[0].id]);
    console.log('Cleaned up test row');
  } catch(e) {
    console.log('ERROR:', e.message);
    console.log('DETAIL:', e.detail);
  }

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
