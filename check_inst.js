const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT i.status AS inst_status FROM users u LEFT JOIN institutes i ON i.id = u.institute_id WHERE LOWER(u.email) = LOWER($1)', ['odm@gmail.com']);
  console.log('Institute status:', res.rows[0]?.inst_status);
  await client.end();
}).catch(console.error);
