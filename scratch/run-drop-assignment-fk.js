const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString:
      process.env.SCHOOL_DB_URL ||
      'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(`
    ALTER TABLE assignments
    DROP CONSTRAINT IF EXISTS "FK_bba4db2b1a9a33de6df91266ec0";
  `);
  console.log('Dropped assignments tenant FK (if it existed).');
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
