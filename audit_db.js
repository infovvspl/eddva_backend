const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Find the first teacher
    const teacherRes = await client.query("SELECT * FROM users WHERE role='TEACHER' LIMIT 1");
    if (teacherRes.rows.length === 0) {
      console.log("No teachers found");
      return;
    }
    const user = teacherRes.rows[0];

    const teacherProfileRes = await client.query("SELECT * FROM teachers WHERE user_id=$1", [user.id]);
    const teacherProfile = teacherProfileRes.rows[0];

    // Let's see some actual assignments to check columns
    const allAss = await client.query("SELECT * FROM assignments LIMIT 1");
    console.log("Sample Assignment Columns:", Object.keys(allAss.rows[0] || {}));
    console.log("Sample Assignment Data:", allAss.rows[0]);

    const attTables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%attend%'");
    console.log("Attendance Tables:", attTables.rows.map(r => r.table_name));

    const attsess = await client.query("SELECT * FROM attendance_sessions LIMIT 1").catch(e=>null);
    if (attsess?.rows[0]) console.log("attendance_sessions sample:", attsess.rows[0]);

    const att = await client.query("SELECT * FROM attendances LIMIT 1").catch(e=>null);
    if (att?.rows[0]) console.log("attendances sample:", att.rows[0]);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
