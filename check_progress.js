const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT * FROM topic_progress WHERE student_id = '5532d95d-5d1a-4f4b-ae18-7cc978db026f'"))
  .then(res => {
    console.log('Topic Progress:', res.rows);
    return client.end();
  })
  .catch(e => console.error(e.message));
