const { Client } = require('pg');
const DB_URL = 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_coaching';

async function investigate() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log("Connected to Coaching DB");

  try {
    // 1. Find teacher
    const teachers = await client.query(`SELECT id, full_name, email, role, tenant_id FROM users WHERE full_name ILIKE '%Krishna Kumar%' AND LOWER(role::text) = 'teacher'`);
    console.log("Teacher(s):", teachers.rows);
    const teacher = teachers.rows[0];
    const teacherId = teacher?.id;

    // 2. Find students
    const students = await client.query(`SELECT id, full_name, email, role, tenant_id FROM users WHERE full_name ILIKE ANY (ARRAY['%Bhagyasree Sendh%', '%Subham Mishra%', '%Akankshya Kar%']) AND LOWER(role::text) = 'student'`);
    console.log("Student(s):", students.rows);

    if (teacherId) {
       for (const student of students.rows) {
          // Check tenant_id match
          console.log(`\nChecking student ${student.full_name} (${student.id}) vs teacher ${teacherId}`);
          console.log(`Student tenant: ${student.tenant_id}, Teacher tenant: ${teacher.tenant_id}`);
          
          // Check batch linkage using the exact SQL from backend
          const sql = `
            SELECT b.id as batch_id, b.name as batch_name, s.id as student_id, e.status as enrollment_status, b.teacher_id as batch_teacher_id, bst.teacher_id as bst_teacher_id
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            JOIN batches b ON b.id = e.batch_id
            LEFT JOIN batch_subject_teachers bst ON bst.batch_id = b.id AND bst.teacher_id = $1
            WHERE s.user_id = $2
              AND e.status = 'active'
              AND (b.teacher_id = $1 OR bst.teacher_id IS NOT NULL)
          `;
          const res = await client.query(sql, [teacherId, student.id]);
          console.log(`Linkage results for ${student.full_name} (using user_id = uuid):`, res.rows);
          
          // Let's also check what students they ARE linked to, just in case `s.user_id` should be something else.
          const checkRawEnrollment = await client.query(`
            SELECT s.user_id as student_user_id, s.id as student_id, b.id as batch_id, b.teacher_id as b_teacher_id
            FROM enrollments e
            JOIN students s ON s.id = e.student_id
            JOIN batches b ON b.id = e.batch_id
            WHERE s.user_id = $1
          `, [student.id]);
          console.log(`Raw enrollments for ${student.full_name} (WHERE s.user_id = uuid):`, checkRawEnrollment.rows);
          
          // Let's also check if user_id is a different column in students
          const checkStudentTable = await client.query(`SELECT * FROM students WHERE user_id = $1 OR id = $1`, [student.id]);
          console.log(`Student record from 'students' table:`, checkStudentTable.rows);
       }
       
       // What batches does this teacher teach?
       // Wait, in coaching DB, batches usually use teacher_id as INTEGER or UUID?
       // Let's check table structure
       const teacherBatches = await client.query(`SELECT id as batch_id, name as batch_name, teacher_id FROM batches WHERE teacher_id = $1`, [teacherId]).catch(e => console.log('Error querying batches:', e.message));
       if (teacherBatches && teacherBatches.rows) {
           console.log(`\nBatches owned by Teacher ${teacherId}:`, teacherBatches.rows);
       }
       
       const teacherSubjectsBatches = await client.query(`SELECT batch_id, teacher_id FROM batch_subject_teachers WHERE teacher_id = $1`, [teacherId]).catch(e => console.log('Error querying batch_subject_teachers:', e.message));
       if (teacherSubjectsBatches && teacherSubjectsBatches.rows) {
           console.log(`\nBatches as Subject Teacher for Teacher ${teacherId}:`, teacherSubjectsBatches.rows);
       }
       
       
       const sampleBatches = await client.query(`SELECT id, name, teacher_id FROM batches LIMIT 5`);
       console.log('\nSample batches:', sampleBatches.rows);

       const checkTeacherTable = await client.query(`SELECT id, user_id FROM teachers WHERE user_id = $1`, [teacherId]).catch(e => {
          console.log("No teachers table or error:", e.message);
          return null;
       });
       if (checkTeacherTable && checkTeacherTable.rows.length) {
           console.log(`\nTeacher record from 'teachers' table:`, checkTeacherTable.rows);
           const numericTeacherId = checkTeacherTable.rows[0].id;
           
           // Query batches with numeric teacher_id
           const numericTeacherBatches = await client.query(`SELECT id as batch_id, name as batch_name, teacher_id FROM batches WHERE teacher_id = $1::uuid OR teacher_id::text = $1::text`, [numericTeacherId]).catch(e => null);
           if (numericTeacherBatches) console.log(`Batches owned by Teacher numeric/uuid ID ${numericTeacherId}:`, numericTeacherBatches.rows);
           
           const numericTeacherSubjects = await client.query(`SELECT batch_id, teacher_id FROM batch_subject_teachers WHERE teacher_id = $1::uuid OR teacher_id::text = $1::text`, [numericTeacherId]).catch(e => null);
           if (numericTeacherSubjects) console.log(`Batches as Subject Teacher for numeric/uuid ID ${numericTeacherId}:`, numericTeacherSubjects.rows);
       } else {
           // Maybe try finding teacher in `teachers` by email?
           const teachersByEmail = await client.query(`SELECT id, user_id FROM teachers WHERE user_id = $1`, [teacherId]).catch(e=>null);
           if (teachersByEmail) {
             console.log("Teachers found by user_id:", teachersByEmail.rows);
           }
       }
       
    }
  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
}

investigate();
