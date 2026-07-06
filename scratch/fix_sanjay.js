const { Client } = require('pg');
require('dotenv').config({ path: __dirname + '/../.env' });

const client = new Client({
  connectionString: process.env.SCHOOL_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const instRes = await client.query("SELECT st.institute_id FROM students st WHERE st.enrollment_no = 'APS-002'");
  if (instRes.rows.length === 0) {
    console.log('Student not found');
    await client.end();
    return;
  }
  const instId = instRes.rows[0].institute_id;
  
  const secRes = await client.query(
    "SELECT sec.id as section_id, sec.name as section_name, c.name as class_name FROM sections sec JOIN classes c ON c.id = sec.class_id WHERE c.institute_id = $1 AND (c.name ILIKE '%Class 10%' OR c.name ILIKE '%Class-10%')",
    [instId]
  );
  
  const targetSec = secRes.rows.find(r => r.section_name === 'A');
  if (targetSec) {
    await client.query("UPDATE students SET section_id = $1 WHERE enrollment_no = 'APS-002'", [targetSec.section_id]);
    console.log("Restored Sanjay Behera (APS-002) back to Class 10 Section A (ID: " + targetSec.section_id + ")");
  } else {
    console.log("Section A not found", secRes.rows);
  }

  await client.end();
}

run().catch(console.error);
