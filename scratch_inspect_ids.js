const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const ids = [
      'e2840eda-64d3-4a41-ab01-48c76a610ee9',
      '2be2d6ff-c99d-475a-9eb5-bc0ac4054339'
    ];

    for (const id of ids) {
      console.log(`\nChecking ID: ${id}`);
      
      const userRes = await client.query("SELECT id, name, email, role FROM users WHERE id = $1", [id]);
      if (userRes.rows.length > 0) {
        console.log("-> Found in USERS table:", userRes.rows[0]);
      } else {
        console.log("-> NOT found in USERS table");
      }

      const teacherRes = await client.query("SELECT id, user_id, employee_id FROM teachers WHERE id = $1", [id]);
      if (teacherRes.rows.length > 0) {
        console.log("-> Found in TEACHERS table:", teacherRes.rows[0]);
      } else {
        console.log("-> NOT found in TEACHERS table");
      }
      
      const teacherByUserRes = await client.query("SELECT id, user_id, employee_id FROM teachers WHERE user_id = $1", [id]);
      if (teacherByUserRes.rows.length > 0) {
        console.log("-> Found in TEACHERS table as user_id:", teacherByUserRes.rows[0]);
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

run();
