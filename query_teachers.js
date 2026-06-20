const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  try {
    const res = await client.query(`
      SELECT u.id, u.role, u.institute_id, u.email, a.status 
      FROM users u
      LEFT JOIN attendances a ON a.user_id = u.id AND a.date = CURRENT_DATE
      WHERE u.role = 'TEACHER'
      LIMIT 2;
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
