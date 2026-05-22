const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT title, deadline_at, created_at FROM mock_tests ORDER BY created_at DESC LIMIT 5"))
  .then(res => {
    console.table(res.rows);
    return client.end();
  })
  .catch(e => console.error(e.message));
