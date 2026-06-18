const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const teacherUserId = '3d0eabde-0695-4935-9dd9-da21ae1dced8'; // Pratap's user_id
    const user = { role: 'ADMIN', instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1' };
    const query = { teacherUserId };

    const instituteId = user.instituteId;
    let classIds = [];
    let sectionIds = [];
    let subjectIds = [];

    const teacherRows = await client.query(`SELECT id FROM teachers WHERE user_id::text=$1::text LIMIT 1`, [teacherUserId]);
    const teacherId = teacherRows.rows[0]?.id;
    console.log('teacherId resolved:', teacherId);

    const assignments = await client.query(
        `SELECT DISTINCT
           ta.class_id::text AS class_id,
           c.name AS class_name,
           ta.section_id::text AS section_id,
           sec.name AS section_name,
           ta.subject_id::text AS subject_id,
           sub.name AS subject_name,
           COALESCE(ta.is_class_teacher, false) AS is_class_teacher
         FROM teacher_academic_assignments ta
         LEFT JOIN classes c ON c.id::text=ta.class_id::text
         LEFT JOIN sections sec ON sec.id::text=ta.section_id::text
         LEFT JOIN subjects sub ON sub.id::text=ta.subject_id::text
         WHERE ta.teacher_id::text=$1::text
         UNION
         SELECT
           sec.class_id::text AS class_id,
           c.name AS class_name,
           sec.id::text AS section_id,
           sec.name AS section_name,
           sub.id::text AS subject_id,
           sub.name AS subject_name,
           true AS is_class_teacher
         FROM sections sec
         LEFT JOIN classes c ON c.id::text=sec.class_id::text
         LEFT JOIN subjects sub
           ON sub.institute_id::text=c.institute_id::text
          AND (
            sub.section_id::text=sec.id::text
            OR (sub.section_id IS NULL AND sub.class_id::text=sec.class_id::text)
          )
         WHERE sec.class_teacher_id::text=$1::text`,
        [teacherId]
    );

    console.log('Assignments resolved count:', assignments.rows.length);

    const effectiveAssignments = assignments.rows;
    const classTeacherAssignments = effectiveAssignments.filter((row) => row.is_class_teacher);
    const useClassTeacherScope = classTeacherAssignments.length > 0;

    const assignedClassIds = effectiveAssignments.map((row) => row.class_id).filter(Boolean).map(String);
    const assignedSectionIds = effectiveAssignments.map((row) => row.section_id).filter(Boolean).map(String);
    const assignedSubjectIds = useClassTeacherScope
      ? []
      : effectiveAssignments.map((row) => row.subject_id).filter(Boolean).map(String);

    classIds = assignedClassIds;
    sectionIds = assignedSectionIds;
    subjectIds = assignedSubjectIds;

    console.log('classIds:', classIds);
    console.log('sectionIds:', sectionIds);
    console.log('subjectIds:', subjectIds);

    // Let's run the actual assessments query
    let assessmentsQuery = `SELECT id, title, class_id, subject_id, total_marks FROM assessments WHERE (teacher_id::text = $1::text OR teacher_id::text = $2::text)`;
    const assessmentsParams = [teacherUserId, teacherId];

    if (classIds.length) {
      assessmentsParams.push(classIds);
      assessmentsQuery += ` OR (class_id::text = ANY($${assessmentsParams.length}::text[])`;
      if (subjectIds.length) {
        assessmentsParams.push(subjectIds);
        assessmentsQuery += ` AND subject_id::text = ANY($${assessmentsParams.length}::text[])`;
      }
      assessmentsQuery += `)`;
    }

    console.log('assessmentsQuery:', assessmentsQuery);
    console.log('assessmentsParams:', assessmentsParams);

    const assessments = await client.query(assessmentsQuery, assessmentsParams);
    console.log('Assessments resolved count:', assessments.rows.length);
    console.log('Assessments:', assessments.rows);

    if (assessments.rows.length > 0) {
      const ids = assessments.rows.map(r => r.id);
      const subs = await client.query('SELECT COUNT(*) FROM assessment_submissions WHERE assessment_id = ANY($1::uuid[])', [ids]);
      console.log('Submissions:', subs.rows);
      const res = await client.query('SELECT COUNT(*) FROM results WHERE assessment_id = ANY($1::uuid[])', [ids]);
      console.log('Results:', res.rows);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
