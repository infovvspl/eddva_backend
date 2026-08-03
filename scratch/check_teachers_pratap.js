const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const pratapUserId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
  
  const res = await c.query("SELECT * FROM teachers WHERE user_id = $1", [pratapUserId]);
  console.log("Teachers Rows count:", res.rows.length);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const nonNull = {};
    for (const key in row) {
      if (row[key] !== null) {
        nonNull[key] = row[key];
      }
    }
    console.log("Non-null fields in teachers row:", nonNull);
  }

  await c.end();
}
run();
