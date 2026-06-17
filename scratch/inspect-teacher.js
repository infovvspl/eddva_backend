require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.SCHOOL_DB_URL || 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';
  console.log('Connecting to database...');
  const client = new Client({
    connectionString,
    ssl: connectionString.includes('supabase') || connectionString.includes('aws') || connectionString.includes('elephantsql') ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();
  const res = await client.query(`
    SELECT * FROM teachers LIMIT 1;
  `);
  console.log('QueryResult:');
  if (res.rows.length > 0) {
    console.log(Object.keys(res.rows[0]));
  } else {
    console.log('No rows found');
  }
  await client.end();
}
main().catch(console.error);
