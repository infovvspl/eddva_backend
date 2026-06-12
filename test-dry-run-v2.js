const { Client } = require('pg');

async function dryRunV2() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const allStudents = await client.query(`
      SELECT 
        u.id AS user_id, 
        u.name, 
        u.email,
        u.created_at,
        s.id AS student_id, 
        s.enrollment_no 
      FROM users u
      JOIN students s ON u.id = s.user_id
      WHERE u.role = 'STUDENT'
      ORDER BY u.created_at ASC
    `);

    const protectedList = [];
    const keepList = [];
    const deleteList = [];

    for (const st of allStudents.rows) {
      if (st.enrollment_no === 'OPS-2026-002') {
        protectedList.push(st);
      } else if (st.enrollment_no && st.enrollment_no.startsWith('OPS-')) {
        // Likely real students based on prefix OPS-
        keepList.push(st);
      } else if (st.enrollment_no && st.enrollment_no.startsWith('ENR')) {
        // Likely demo data
        deleteList.push(st);
      } else {
        // Unknown, let's put in keep to be safe, but print them out
        keepList.push(st);
      }
    }

    console.log('PROTECTED');
    console.log('-----------');
    for (const st of protectedList) {
      console.log(`Name: ${st.name}\nUser ID: ${st.user_id}\nStudent ID: ${st.student_id}\nEnrollment: ${st.enrollment_no}\nCreated: ${st.created_at}\n`);
    }

    console.log('KEEP');
    console.log('-----------');
    for (const st of keepList) {
      console.log(`Name: ${st.name}\nUser ID: ${st.user_id}\nStudent ID: ${st.student_id}\nEnrollment: ${st.enrollment_no}\nCreated: ${st.created_at}\n`);
    }

    console.log('DELETE');
    console.log('-----------');
    for (const st of deleteList) {
      console.log(`Name: ${st.name}\nUser ID: ${st.user_id}\nStudent ID: ${st.student_id}\nEnrollment: ${st.enrollment_no}\nCreated: ${st.created_at}\n`);
    }

    console.log(`Total Protected: ${protectedList.length}`);
    console.log(`Total Keep: ${keepList.length}`);
    console.log(`Total Delete: ${deleteList.length}`);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

dryRunV2();
