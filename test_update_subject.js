const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  console.log('Running manual update...');
  const res = await client.query(`
    UPDATE subjects 
    SET code = 'MATH-TEST', type = 'Theory', description = 'Test desc', updated_at = NOW()
    WHERE id = '6bda44a0-0523-42cc-90f6-97e50286b91e'
    RETURNING *;
  `);
  console.log('Update result rows:', JSON.stringify(res.rows, null, 2));
  await client.end();
}

run().catch(console.error);
