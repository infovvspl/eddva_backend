const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("UPDATE mock_tests SET deadline_at = '2026-05-24T12:00:00Z' WHERE title = 'Plant Physiology — Chapter Test'"))
  .then(() => {
    console.log("Updated Mock Test");
    return client.end();
  })
  .catch(e => console.error(e.message));
