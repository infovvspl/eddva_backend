const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.SCHOOL_DB_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT id, title, deadline_at FROM mock_tests ORDER BY created_at DESC LIMIT 5"))
  .then(res => {
    console.table(res.rows);
    return client.end();
  })
  .catch(e => console.error(e.message));
