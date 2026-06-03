const { Client } = require('pg');
async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  // 1. Check chapter exists
  console.log('=== Chapter 38226e46 ===');
  const ch = await c.query(`SELECT * FROM chapters WHERE id='38226e46-16eb-4cde-8ab2-31a3ac085c60'`);
  console.log(JSON.stringify(ch.rows, null, 2));

  // 2. List all FKs on topics table
  console.log('\n=== Foreign Keys on topics table ===');
  const fks = await c.query(`
    SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'topics' AND tc.constraint_type = 'FOREIGN KEY'
  `);
  console.log(JSON.stringify(fks.rows, null, 2));

  // 3. Topics table columns
  console.log('\n=== Topics table columns ===');
  const cols = await c.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='topics' ORDER BY ordinal_position`);
  console.log(JSON.stringify(cols.rows, null, 2));

  // 4. Try the exact INSERT that createTopic would do
  console.log('\n=== Test INSERT ===');
  try {
    const r = await c.query(
      `INSERT INTO topics (chapter_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      ['38226e46-16eb-4cde-8ab2-31a3ac085c60', 'c259cd4e-b018-45e2-8e46-52a497ca49a1', 'FK Test Topic', 0]
    );
    console.log('SUCCESS:', JSON.stringify(r.rows[0]));
    await c.query(`DELETE FROM topics WHERE id=$1`, [r.rows[0].id]);
  } catch(e) {
    console.log('ERROR:', e.message);
    console.log('DETAIL:', e.detail);
    console.log('CONSTRAINT:', e.constraint);
  }

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
