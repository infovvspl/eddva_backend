require('dotenv').config();
const { Client } = require('pg');

async function run() {
  if (!process.env.COACHING_DB_URL || !process.env.SCHOOL_DB_URL) {
    console.error('Error: Database connection URLs not found in environment.');
    process.exit(1);
  }

  const coachingClient = new Client({ connectionString: process.env.COACHING_DB_URL });
  const schoolClient = new Client({ connectionString: process.env.SCHOOL_DB_URL });

  try {
    await coachingClient.connect();
    await schoolClient.connect();

    console.log("==========================================");
    console.log("COACHING DB — recent messages");
    console.log("==========================================");
    
    try {
      const coachingRes = await coachingClient.query(
        'SELECT id, sender_id, receiver_id, SUBSTRING(text, 1, 50) as content, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 5'
      );
      if (coachingRes.rows.length === 0) {
        console.log("No messages found.");
      } else {
        console.table(coachingRes.rows);
      }
    } catch (err) {
      console.error('Error querying Coaching DB:', err.message);
    }

    console.log("\n==========================================");
    console.log("SCHOOL DB — recent messages");
    console.log("==========================================");
    
    try {
      const schoolRes = await schoolClient.query(
        'SELECT id, sender_id, receiver_id, SUBSTRING(text, 1, 50) as content, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 5'
      );
      if (schoolRes.rows.length === 0) {
        console.log("No messages found.");
      } else {
        console.table(schoolRes.rows);
      }
    } catch (err) {
      console.error('Error querying School DB:', err.message);
    }

  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await coachingClient.end();
    await schoolClient.end();
  }
}

run().catch(console.error);
