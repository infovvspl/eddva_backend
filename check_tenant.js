const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const res = await client.query('SELECT status FROM tenants WHERE subdomain = $1', ['odm']);
  console.log('Tenant status:', res.rows[0]?.status);
  await client.end();
}).catch(console.error);
