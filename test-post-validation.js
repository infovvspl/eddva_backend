const { Client } = require('pg');

async function validation() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('--- POST-EXECUTION VALIDATION ---');

    const pratap = await client.query(`SELECT u.name, s.enrollment_no, u.id FROM users u JOIN students s ON u.id = s.user_id WHERE u.id='b49ee8d3-4c33-448c-aa06-30dc8bfbee54'`);
    if(pratap.rows.length) {
      console.log(`1. Pratap Das still exists.`);
      console.log(`Name: ${pratap.rows[0].name}, Enrollment: ${pratap.rows[0].enrollment_no}, User ID: ${pratap.rows[0].id}`);
    } else { console.log('1. Pratap Das is MISSING!'); }

    const s1 = await client.query(`SELECT u.name, s.enrollment_no, u.id FROM users u JOIN students s ON u.id = s.user_id WHERE s.enrollment_no='OPS-2026-001'`);
    if(s1.rows.length) {
      console.log(`2. OPS-2026-001 still exists.`);
      console.log(`Name: ${s1.rows[0].name}, Enrollment: ${s1.rows[0].enrollment_no}, User ID: ${s1.rows[0].id}`);
    }

    const s2 = await client.query(`SELECT u.name, s.enrollment_no, u.id FROM users u JOIN students s ON u.id = s.user_id WHERE s.enrollment_no='OPS-2026-002'`);
    if(s2.rows.length) {
      console.log(`3. OPS-2026-002 still exists.`);
      console.log(`Name: ${s2.rows[0].name}, Enrollment: ${s2.rows[0].enrollment_no}, User ID: ${s2.rows[0].id}`);
    }

    const s3 = await client.query(`SELECT u.name, s.enrollment_no, u.id FROM users u JOIN students s ON u.id = s.user_id WHERE s.enrollment_no='OPS-2026-003'`);
    if(s3.rows.length) {
      console.log(`4. OPS-2026-003 still exists.`);
      console.log(`Name: ${s3.rows[0].name}, Enrollment: ${s3.rows[0].enrollment_no}, User ID: ${s3.rows[0].id}`);
    }

    const enrCount = await client.query(`SELECT COUNT(*) FROM students WHERE enrollment_no LIKE 'ENR%'`);
    console.log(`\nSELECT COUNT(*) of remaining ENR students: ${enrCount.rows[0].count}`);

    const opsCount = await client.query(`SELECT COUNT(*) FROM students WHERE enrollment_no LIKE 'OPS%'`);
    console.log(`SELECT COUNT(*) of remaining OPS students: ${opsCount.rows[0].count}`);

    const totalStudents = await client.query(`SELECT COUNT(*) FROM students`);
    const totalUsers = await client.query(`SELECT COUNT(*) FROM users WHERE role='STUDENT'`);
    
    console.log(`\nRemaining Total Students: ${totalStudents.rows[0].count}`);
    console.log(`Remaining Total Student Users: ${totalUsers.rows[0].count}`);

    if (parseInt(enrCount.rows[0].count) === 0 && parseInt(opsCount.rows[0].count) >= 3) {
      console.log('\nOutput: PASS');
    } else {
      console.log('\nOutput: FAIL');
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
validation();
