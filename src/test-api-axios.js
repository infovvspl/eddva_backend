const axios = require('axios');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.SCHOOL_DB_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Find the teacher that has records
    const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
    const tRes = await client.query(`SELECT email FROM users WHERE id = $1`, [teacherId]);
    const email = tRes.rows[0].email;
    console.log(`Teacher Email: ${email}`);
    
    // We don't know the password to log in via API.
    // BUT we can just bypass and directly query the DB to see if `ANY($1)` fails in TypeORM!
    // Wait! To test the API, I need to log in!
    console.log("Since I don't know the password, I will just output what is already known.");
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
