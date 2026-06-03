const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT id, email, role, is_active, institute_id FROM users WHERE LOWER(email) = LOWER($1)', ['odm@gmail.com']);
  console.log('Users found:', res.rows);
  await client.end();
}).catch(console.error);
