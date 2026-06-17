const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function main() {
  const connectionString = process.env.SCHOOL_DB_URL;
  if (!connectionString) {
    console.error('SCHOOL_DB_URL not found in .env');
    return;
  }
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(`
    SELECT t.id, u.name, t.qualifications, t.nationality, t.address, t.city, t.state, t.pin_code, t.country
    FROM teachers t
    JOIN users u ON t.user_id = u.id
    LIMIT 5;
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}

main().catch(console.error);
