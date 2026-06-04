const { Client } = require('pg');
const connectionString = process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const client = new Client({ connectionString });

async function runAudit() {
  await client.connect();
  const results = {};

  const query = async (name, sql) => {
    try {
      const res = await client.query(sql);
      results[name] = { sql, data: res.rows };
    } catch (e) {
      results[name] = { sql, error: e.message };
    }
  };

  await query('topics_columns', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'topics'");
  await query('chapters_columns', "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chapters'");
  
  await query('topics_fks', `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='topics'
  `);

  await query('chapters_fks', `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='chapters'
  `);

  console.log(JSON.stringify(results, null, 2));

  await client.end();
}

runAudit().catch(console.error);
