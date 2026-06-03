const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  
  await c.connect();
  
  // Try to insert a chapter WITHOUT institute_id to see the exact error
  console.log('=== TESTING INSERT WITH NULL institute_id ===');
  try {
    const r = await c.query(
      `INSERT INTO chapters (subject_id,institute_id,name,description,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      ['6bda44a0-0523-42cc-90f6-97e50286b91e', null, 'TEST NULL INSTITUTE', null, 0]
    );
    console.log('SUCCESS:', JSON.stringify(r.rows[0]));
  } catch(e) {
    console.log('ERROR:', e.message);
  }
  
  // Try to insert with description column
  console.log('\n=== TESTING INSERT WITH description column ===');
  try {
    const r = await c.query(
      `INSERT INTO chapters (subject_id,institute_id,name,description,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      ['6bda44a0-0523-42cc-90f6-97e50286b91e', 'c259cd4e-b018-45e2-8e46-52a497ca49a1', 'TEST WITH DESC', 'some desc', 0]
    );
    console.log('SUCCESS:', JSON.stringify(r.rows[0]));
    // cleanup
    await c.query(`DELETE FROM chapters WHERE id=$1`, [r.rows[0].id]);
  } catch(e) {
    console.log('ERROR:', e.message);
  }
  
  // Try to insert WITHOUT description column
  console.log('\n=== TESTING INSERT WITHOUT description column ===');
  try {
    const r = await c.query(
      `INSERT INTO chapters (subject_id,institute_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      ['6bda44a0-0523-42cc-90f6-97e50286b91e', 'c259cd4e-b018-45e2-8e46-52a497ca49a1', 'TEST NO DESC', 0]
    );
    console.log('SUCCESS:', JSON.stringify(r.rows[0]));
    // cleanup
    await c.query(`DELETE FROM chapters WHERE id=$1`, [r.rows[0].id]);
  } catch(e) {
    console.log('ERROR:', e.message);
  }
  
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
