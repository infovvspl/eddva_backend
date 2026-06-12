const { Client } = require('pg');

async function run() {
  const schoolClient = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  await schoolClient.connect();

  console.log("--- Gamification Profiles ---");
  const profiles = await schoolClient.query(`SELECT * FROM gamification_profiles`);
  console.log(profiles.rows);

  console.log("\n--- Gamification History ---");
  const history = await schoolClient.query(`SELECT * FROM gamification_history ORDER BY created_at DESC LIMIT 10`);
  console.log(history.rows);

  console.log("\n--- Student Activity Log ---");
  const activity = await schoolClient.query(`SELECT * FROM student_activity ORDER BY created_at DESC LIMIT 20`);
  console.log(activity.rows);

  await schoolClient.end();
}

run().catch(console.error);
