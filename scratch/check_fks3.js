const { Client } = require('pg');
async function main() {
  const c = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  console.log('=== Foreign Keys on topics.institute_id ===');
  const fks = await c.query(`
    SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'topics' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'institute_id'
  `);
  console.log(JSON.stringify(fks.rows, null, 2));

  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
