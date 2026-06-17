const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    const usersRes = await client.query(`SELECT id, email, role, institute_id FROM users LIMIT 10`);
    console.log("Users:");
    console.log(usersRes.rows);

    const studentsRes = await client.query(`SELECT id, user_id, class_id, section_id FROM students LIMIT 10`);
    console.log("Students:");
    console.log(studentsRes.rows);
  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
