const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log("Searching for Pratap in users table...");
  const usersRes = await c.query("SELECT * FROM users WHERE name ILIKE '%Pratap%'");
  console.log("Users:", JSON.stringify(usersRes.rows, null, 2));

  if (usersRes.rows.length > 0) {
    const userId = usersRes.rows[0].id;
    console.log(`Searching for teacher profiles / details linked to user ID ${userId}...`);
    
    // Check teacher_profiles
    const profilesRes = await c.query("SELECT * FROM teacher_profiles WHERE user_id = $1", [userId]);
    console.log("Teacher Profiles:", JSON.stringify(profilesRes.rows, null, 2));

    if (profilesRes.rows.length > 0) {
      const profileId = profilesRes.rows[0].id;
      // Check academic assignments or whatever columns/tables exist
      console.log(`Checking academic assignments/details for teacher profile ID ${profileId}...`);
      
      // Let's inspect the database schema or query assignments
      try {
        const assignmentsRes = await c.query("SELECT * FROM teacher_assignments WHERE teacher_profile_id = $1", [profileId]);
        console.log("Assignments:", JSON.stringify(assignmentsRes.rows, null, 2));
      } catch (err) {
        console.log("Error querying teacher_assignments:", err.message);
      }
    }
  }

  await c.end();
}
run();
