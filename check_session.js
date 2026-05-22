const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT * FROM test_sessions WHERE id = '1719bdbd-2f9f-4983-8f80-2f9bc3ac1c5b'"))
  .then(res => {
    console.log(res.rows[0]);
    return client.end();
  })
  .catch(e => console.error(e.message));
