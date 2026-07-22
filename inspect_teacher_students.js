const { Client } = require('pg');
const conn = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching';
const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  try {
    const teacherId = '7ca93500-a9cb-427a-a81c-348192710db4';
    const studentNames = ['Bhagyasree Sendh', 'Subham Mishra', 'Akankshya Kar'];
    const students = {};
    for (const name of studentNames) {
      const res = await client.query(`SELECT id, full_name FROM users WHERE full_name ILIKE $1`, [`%${name}%`]);
      if (res.rows.length) {
        students[name] = res.rows[0].id;
      }
    }
    const studentIds = Object.values(students);
    const enrollRes = await client.query(
      `SELECT s.user_id, b.id AS batch_id, b.name AS batch_name, b.institute_id, e.status
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       JOIN batches b ON b.id = e.batch_id
       WHERE s.user_id = ANY($1)`,
      [studentIds]
    );
    const teacherBatches = await client.query(`SELECT id, name, institute_id FROM batches WHERE teacher_id = $1`, [teacherId]);
    const teacherSubjects = await client.query(`SELECT batch_id, teacher_id FROM batch_subject_teachers WHERE teacher_id = $1`, [teacherId]);
    const teacherColumns = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE column_name ILIKE '%teacher_id%'`);
    console.log(JSON.stringify({ students, enrollments: enrollRes.rows, teacherBatches: teacherBatches.rows, teacherSubjects: teacherSubjects.rows, teacherColumns: teacherColumns.rows }, null, 2));
  } finally {
    await client.end();
  }
}
run();
