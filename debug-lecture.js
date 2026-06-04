const { DataSource } = require('typeorm');
const src = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
src.initialize().then(async () => {
  // Check lecture tenant
  const lecture = await src.query(`SELECT id, tenant_id, title, batch_id FROM lectures WHERE id = '7e125cc4-4c20-4914-b9b8-4979cbab290c'`);
  console.log('Lecture:', JSON.stringify(lecture));

  // Check batch tenant
  const batch = await src.query(`SELECT id, tenant_id, name FROM batches LIMIT 5`);
  console.log('Batches:', JSON.stringify(batch));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
