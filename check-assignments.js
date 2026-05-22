const { DataSource } = require('typeorm');
const src = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
src.initialize().then(async () => {
  // Check if tables exist
  const tables = await src.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('lecture_assignments', 'assignment_submissions') AND table_schema='public'`);
  console.log('Tables found:', JSON.stringify(tables));

  // Check rows in lecture_assignments
  try {
    const rows = await src.query('SELECT * FROM lecture_assignments LIMIT 10');
    console.log('lecture_assignments rows:', JSON.stringify(rows));
  } catch(e) {
    console.log('lecture_assignments error:', e.message);
  }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
