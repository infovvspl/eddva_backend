const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT * FROM mock_tests WHERE id = '07cad42e-4610-489b-85f0-48b9954f35cc'"))
  .then(res => {
    console.log(res.rows[0]);
    return client.end();
  })
  .catch(e => console.error(e.message));
