const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT id, email, role, password FROM users WHERE email = $1', ['odm@gmail.com']);
  console.log(res.rows);
  await client.end();
}).catch(console.error);
