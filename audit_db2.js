const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const id = '911eeb3d-60ce-4ba5-b476-9c0b975b666b';
    
    const u = await client.query("SELECT * FROM users WHERE id=$1", [id]);
    console.log("Is it a user.id?", u.rowCount > 0);

    const t = await client.query("SELECT * FROM teachers WHERE id=$1", [id]);
    console.log("Is it a teacher_profile.id?", t.rowCount > 0);

    // Let's also check attendances table
    const a = await client.query("SELECT * FROM attendances WHERE user_id=$1", [id]);
    console.log("attendances count for user_id:", a.rowCount);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
