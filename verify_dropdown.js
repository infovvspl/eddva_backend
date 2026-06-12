const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // 1. Get a teacher to simulate
    const teachers = await client.query("SELECT * FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.institute_id IS NOT NULL LIMIT 1");
    if (teachers.rows.length === 0) {
      console.log('No teachers found.');
      return;
    }
    const teacher = teachers.rows[0];
    console.log('Current teacher record:', { id: teacher.id, user_id: teacher.user_id, name: teacher.name });

    // 2. Assigned sections
    const taa = await client.query("SELECT * FROM teacher_academic_assignments WHERE teacher_id = $1", [teacher.id]);
    console.log('Assigned sections (TAA):', taa.rows);

    // 3. Class teacher sections
    const sec = await client.query("SELECT id, name, class_teacher_id FROM sections WHERE class_teacher_id = $1", [teacher.id]);
    console.log('Class teacher sections:', sec.rows);

    // 4. Students found
    const studentsQuery = `
      SELECT s.id, s.user_id, s.section_id, s.parent_email, s.parent_phone, s.father_name, s.mother_name 
      FROM students s
      JOIN sections sec ON sec.id = s.section_id
      WHERE sec.class_teacher_id = $1 
         OR s.section_id IN (SELECT section_id FROM teacher_academic_assignments WHERE teacher_id = $1)
    `;
    const students = await client.query(studentsQuery, [teacher.id]);
    console.log('Students found:', students.rows);

    // 5. Parent links found
    const parentsQuery = `
       SELECT 
        c.name AS class_name,
        sec.name AS section_name,
        COALESCE(s.father_name, s.mother_name) AS parent_name,
        s.parent_phone,
        u.name AS student_name,
        p.id AS parent_id,
        p.name AS parent_name_user,
        p.email AS parent_email
       FROM students s
       JOIN users u ON s.user_id = u.id
       JOIN sections sec ON s.section_id = sec.id
       JOIN classes c ON sec.class_id = c.id
       LEFT JOIN users p ON p.institute_id = s.institute_id AND p.role = 'PARENT' AND (
         (p.email IS NOT NULL AND LOWER(p.email) = LOWER(s.parent_email))
         OR
         (p.phone IS NOT NULL AND p.phone = s.parent_phone)
       )
       WHERE sec.class_teacher_id = $1 
          OR s.section_id IN (SELECT section_id FROM teacher_academic_assignments WHERE teacher_id = $1)
    `;
    const parents = await client.query(parentsQuery, [teacher.id]);
    console.log('Final parents returned:', parents.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
