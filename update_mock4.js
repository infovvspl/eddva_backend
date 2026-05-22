const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("UPDATE mock_tests SET deadline_at = '2026-05-22T23:59:59.000Z' WHERE title = 'Mathematics — Subject Test' OR title = 'Henry''s Law — Topic Test'"))
  .then(res => {
    console.log("Updated rows:", res.rowCount);
    return client.end();
  })
  .catch(e => console.error(e.message));
