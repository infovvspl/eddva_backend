const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.COACHING_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connecting to Coaching Database...');

  const results = await client.query(`
    SELECT id, title, target_role, created_at
    FROM announcements
    ORDER BY created_at DESC;
  `);

  console.log('--- PAST ANNOUNCEMENTS IN DB ---');
  if (results.rows.length === 0) {
    console.log("No announcements found.");
  }
  
  results.rows.forEach(a => {
    console.log(`ID: ${a.id} | Title: "${a.title}" | Target Role: ${a.target_role} | Created: ${a.created_at}`);
  });

  await client.end();
}

run().catch(console.error);
