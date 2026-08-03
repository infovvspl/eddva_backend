const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log("Checking all rows in teachers table:");
  const res = await c.query("SELECT * FROM teachers");
  console.log(res.rows);

  console.log("\nChecking all rows in teacher_profiles table:");
  const res2 = await c.query("SELECT * FROM teacher_profiles");
  console.log(res2.rows);

  await c.end();
}
run();
