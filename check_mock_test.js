const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT question_ids FROM mock_tests WHERE id = '60547c0a-1e79-4db5-b794-5dff54fbc943'"))
  .then(res => {
    console.log(res.rows[0]);
    return client.end();
  })
  .catch(e => console.error(e.message));
