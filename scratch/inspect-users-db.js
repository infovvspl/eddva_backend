const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // 1. Inspect table columns
    const columnsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    console.log('--- USERS TABLE COLUMNS ---');
    columnsRes.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}`);
    });

    // 2. Query duplicates
    const dupRes = await client.query(`
      SELECT phone, institute_id, count(*), array_agg(email) as emails, array_agg(name) as names, array_agg(role) as roles
      FROM users
      WHERE phone IS NOT NULL AND phone <> ''
      GROUP BY phone, institute_id
      HAVING count(*) > 1
    `);
    console.log('\n--- DUPLICATE PHONE/INSTITUTE PAIRS ---');
    console.log(dupRes.rows);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

main();
