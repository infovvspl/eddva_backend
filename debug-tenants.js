const { DataSource } = require('typeorm');
const src = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
src.initialize().then(async () => {
  // Check assignment tenant_id
  const assignments = await src.query(`SELECT id, tenant_id, lecture_id, title FROM lecture_assignments`);
  console.log('Assignments:', JSON.stringify(assignments));

  // Check all tenant IDs for users (students vs teachers)
  const users = await src.query(`SELECT id, role, tenant_id, full_name FROM users LIMIT 20`);
  console.log('Users:', JSON.stringify(users));

  // Check tenant table
  const tenants = await src.query(`SELECT id, name, subdomain FROM tenants LIMIT 10`);
  console.log('Tenants:', JSON.stringify(tenants));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
