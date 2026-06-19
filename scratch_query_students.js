const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    console.log('=== STUDENTS WITH NAME PRATAP DAS OR BHAVYA RATH ===');
    const res = await client.query(`
      SELECT s.id AS student_profile_id, s.user_id, u.name, s.section_id, sec.class_id, c.name AS class_name, sec.name AS section_name
      FROM students s
      JOIN users u ON s.user_id=u.id
      LEFT JOIN sections sec ON s.section_id=sec.id
      LEFT JOIN classes c ON sec.class_id=c.id
      WHERE u.name LIKE '%Pratap%' OR u.name LIKE '%Bhavya%'
    `);
    console.log(res.rows);

    console.log('\n=== ASSESSMENTS FOR PRATAP DAS AND BHAVYA RATH CLASSES ===');
    const classIds = res.rows.map(r => r.class_id).filter(Boolean);
    const assessments = await client.query(`
      SELECT id, title, type, class_id, subject_id, teacher_id 
      FROM assessments 
      WHERE class_id = ANY($1::uuid[])
    `, [classIds]);
    console.log(assessments.rows);

    console.log('\n=== RESULTS FOR PRATAP DAS AND BHAVYA RATH ===');
    const userIds = res.rows.map(r => r.user_id).filter(Boolean);
    const results = await client.query(`
      SELECT r.id, r.assessment_id, r.student_id, r.marks_obtained, r.total_marks, r.percentage, r.is_absent, a.class_id, a.subject_id
      FROM results r
      LEFT JOIN assessments a ON r.assessment_id=a.id
      WHERE r.student_id = ANY($1::uuid[])
    `, [userIds]);
    console.log(results.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
