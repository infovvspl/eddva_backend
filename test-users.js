const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

async function run() {
  await client.connect();

  const tt = await client.query("SELECT * FROM timetables ORDER BY created_at DESC LIMIT 1");
  const timetable = tt.rows[0];

  console.log("Found timetable:", timetable);

  const teacherId = timetable.teacher_id;
  const sectionId = timetable.section_id;

  const teacherRows = await client.query("SELECT * FROM teachers WHERE id = $1", [teacherId]);
  const teacherUser = await client.query("SELECT * FROM users WHERE id = $1", [teacherRows.rows[0].user_id]);

  const studentRows = await client.query("SELECT * FROM students WHERE section_id = $1 LIMIT 1", [sectionId]);
  const studentUser = await client.query("SELECT * FROM users WHERE id = $1", [studentRows.rows[0].user_id]);

  console.log("\nTeacher User:", teacherUser.rows[0].email);
  console.log("Student User:", studentUser.rows[0].email);

  const teacherToken = jwt.sign({
    id: teacherUser.rows[0].id,
    role: 'TEACHER',
    instituteId: teacherUser.rows[0].institute_id
  }, JWT_SECRET, { expiresIn: '1h' });

  const studentToken = jwt.sign({
    id: studentUser.rows[0].id,
    role: 'STUDENT',
    instituteId: studentUser.rows[0].institute_id
  }, JWT_SECRET, { expiresIn: '1h' });

  console.log("\nTeacher Token:", teacherToken);
  console.log("Student Token:", studentToken);

  client.end();
}

run().catch(console.error);
