const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const client = new Client({ connectionString: 'postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT password FROM users WHERE LOWER(email) = LOWER($1)', ['odm@gmail.com']);
  if (res.rows.length > 0) {
    const hash = res.rows[0].password;
    const match = await bcrypt.compare('Admin@123', hash);
    console.log('Password match:', match);
  } else {
    console.log('User not found');
  }
  await client.end();
}).catch(console.error);
