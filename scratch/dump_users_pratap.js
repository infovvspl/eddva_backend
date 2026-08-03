const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log("Users matching Pratap:");
  const usersRes = await c.query("SELECT id, name, role, email, phone FROM users WHERE name ILIKE '%Pratap%'");
  console.log(usersRes.rows);

  console.log("\nTeacher Profiles associated with Pratap's User ID:");
  for (const user of usersRes.rows) {
    const profs = await c.query("SELECT * FROM teacher_profiles WHERE user_id = $1", [user.id]);
    console.log(`User ${user.name} (${user.id}):`, profs.rows);
  }

  console.log("\nAll Teacher Profiles in DB (first 10):");
  const allProfs = await c.query("SELECT tp.*, u.name FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id LIMIT 10");
  console.log(allProfs.rows);

  await c.end();
}
run();
