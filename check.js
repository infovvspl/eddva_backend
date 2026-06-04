const { DataSource } = require('typeorm');
const src = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
src.initialize().then(async () => {
  const res = await src.query('SELECT tenant_id, count(*) FROM students GROUP BY tenant_id');
  console.log(res);
  process.exit(0);
});
