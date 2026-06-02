const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  console.log('Dropping foreign key constraint on subjects.institute_id');
  await client.query(`ALTER TABLE subjects DROP CONSTRAINT IF EXISTS "FK_31ce5efac405256a51668a0e34e";`);
  await client.query(`ALTER TABLE subjects DROP CONSTRAINT IF EXISTS "fk_31ce5efac405256a51668a0e34e";`);
  console.log('Done.');
  await client.end();
}

run().catch(console.error);
