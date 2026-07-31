const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const res = await client.query(`SELECT id, game_type, metadata FROM school_game_sessions ORDER BY created_at DESC LIMIT 1`);
    const row = res.rows[0];
    if (row) {
      console.log('Session ID:', row.id);
      console.log('Game Type:', row.game_type);
      console.log('Metadata questions length:', row.metadata?.questions?.length);
      if (row.metadata?.questions) {
        row.metadata.questions.forEach((q, i) => {
          console.log(`Question ${i + 1}:`, JSON.stringify(q, null, 2));
        });
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
check();
