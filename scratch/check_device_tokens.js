const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  
  console.log("=== DEVICE TOKENS ===");
  const tokens = await client.query(`SELECT * FROM school_device_tokens;`);
  console.log(tokens.rows);

  console.log("\n=== NOTIFICATION LOGS ===");
  const logs = await client.query(`SELECT * FROM school_notification_log ORDER BY sent_at DESC LIMIT 5;`);
  console.log(logs.rows);

  await client.end();
}

run().catch(console.error);
