const { Client } = require('pg');

async function querySectionSubjects(
  client,
  instituteId,
  sectionId,
  classId,
) {
  const res = await client.query(
    `SELECT DISTINCT sub.id, sub.name
     FROM (
       SELECT s.id, s.name
       FROM subjects s
       WHERE s.institute_id = $1::uuid
         AND (
           s.section_id = $2::uuid
           OR (s.section_id IS NULL AND s.class_id = $3::uuid)
         )
       UNION
       SELECT sub.id, sub.name
       FROM teacher_academic_assignments taa
       INNER JOIN subjects sub ON sub.id = taa.subject_id
       WHERE taa.section_id = $4::uuid
     ) sub
     WHERE sub.id IS NOT NULL
     ORDER BY sub.name`,
    [instituteId, sectionId, classId, sectionId],
  );
  return res.rows;
}

async function loadStudentAcademic(client, userId) {
  const rowsRes = await client.query(
    `SELECT s.id AS student_id, s.section_id, s.institute_id, s.enrollment_no, s.roll_no,
            sec.name AS section_name, c.id AS class_id, c.name AS class_name
     FROM students s
     LEFT JOIN sections sec ON s.section_id = sec.id
     LEFT JOIN classes c ON sec.class_id = c.id
     WHERE s.user_id = $1`,
    [userId],
  );
  if (!rowsRes.rows.length) return null;
  const r = rowsRes.rows[0];
  const subjectRows =
    r.section_id && r.institute_id
      ? await querySectionSubjects(client, r.institute_id, r.section_id, r.class_id)
      : [];
  return {
    id: r.student_id,
    sectionId: r.section_id,
    sectionName: r.section_name,
    classId: r.class_id,
    className: r.class_name,
    enrollmentNo: r.enrollment_no,
    rollNo: r.roll_no,
    subjects: subjectRows.map((s) => s.name),
    subjectList: subjectRows,
    currentClass: r.class_name ? `${r.class_name}${r.section_name ? ` · ${r.section_name}` : ''}` : null,
  };
}

async function run() {
    const client = new Client({
    connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to School DB");

    // Pratap Das
    const userId = "b49ee8d3-4c33-448c-aa06-30dc8bfbee54";
    const profile = await loadStudentAcademic(client, userId);
    console.log("Student Profile Academic Info:");
    console.log(JSON.stringify(profile, null, 2));

  } catch (err) {
    console.error("Database query failed:", err);
  } finally {
    await client.end();
  }
}

run();
