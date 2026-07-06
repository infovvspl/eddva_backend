const { Client } = require('pg');

async function main() {
  const schoolClient = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  const coachingClient = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await schoolClient.connect();
    console.log("Connected to school DB.");
    const schoolUsers = await schoolClient.query("SELECT id, name, email, phone, role, is_active FROM users ORDER BY created_at DESC LIMIT 5");
    console.log("Latest School Users:", schoolUsers.rows);
  } catch (err) {
    console.error("School DB Error:", err);
  } finally {
    await schoolClient.end();
  }

  try {
    await coachingClient.connect();
    console.log("\nConnected to coaching DB.");
    const coachingUsers = await coachingClient.query("SELECT id, \"full_name\", email, \"phone_number\", role, status FROM users ORDER BY \"created_at\" DESC LIMIT 5");
    console.log("Latest Coaching Users:", coachingUsers.rows);
  } catch (err) {
    console.error("Coaching DB Error:", err);
  } finally {
    await coachingClient.end();
  }
}

main().catch(console.error);
