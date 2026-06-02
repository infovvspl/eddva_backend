const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  console.log('Adding columns to subjects...');
  await client.query(`
    ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS code VARCHAR(255),
    ADD COLUMN IF NOT EXISTS type VARCHAR(255) DEFAULT 'Theory',
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);
  console.log('Done.');
  await client.end();
}

run().catch(console.error);
