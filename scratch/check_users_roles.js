const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const res = await c.query(`
    SELECT a.id, a.date, a.status, a.created_at, u.name, u.role
    FROM attendances a
    JOIN users u ON u.id = a.user_id
    WHERE a.date = CURRENT_DATE
    ORDER BY a.created_at DESC
  `);
  console.log("Today's Attendances in DB:");
  console.log(JSON.stringify(res.rows, null, 2));

  await c.end();
}
run();


