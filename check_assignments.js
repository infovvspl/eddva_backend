const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT id, title, due_date FROM lecture_assignments WHERE due_date IS NOT NULL ORDER BY due_date DESC LIMIT 5"))
  .then(res => {
    console.table(res.rows);
    return client.end();
  })
  .catch(e => console.error(e.message));
