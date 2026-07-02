const { Client } = require('pg');

async function check() {
  const coachingClient = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await coachingClient.connect();
    console.log("Connected to Coaching DB.");

    // Query students and their enrollments
    const studentsRes = await coachingClient.query(`
      SELECT s.id, s.user_id, u.full_name, u.role, u.status 
      FROM students s
      JOIN users u ON s.user_id = u.id
      LIMIT 10
    `);
    console.log("Students:", studentsRes.rows);

    for (const student of studentsRes.rows) {
      const enrollRes = await coachingClient.query(`
        SELECT * FROM enrollments WHERE student_id = $1
      `, [student.id]);
      console.log(`Enrollments for ${student.full_name}:`, enrollRes.rows);
    }
  } catch (err) {
    console.error("Coaching DB Error:", err);
  } finally {
    await coachingClient.end();
  }
}

check();
