const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school",
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  const usersRes = await client.query("SELECT id, name, email, role FROM users WHERE role='TEACHER'");
  console.log("Teacher Users:");
  console.log(usersRes.rows);

  for (const user of usersRes.rows) {
    const teacherRes = await client.query("SELECT * FROM teachers WHERE user_id=$1", [user.id]);
    console.log(`\nTeacher Profile for ${user.name}:`, teacherRes.rows);
    if (teacherRes.rows.length) {
      const teacherId = teacherRes.rows[0].id;
      const assignmentsRes = await client.query(
        `SELECT ta.*, c.name as class_name, sec.name as section_name, sub.name as subject_name 
         FROM teacher_academic_assignments ta
         LEFT JOIN classes c ON c.id = ta.class_id
         LEFT JOIN sections sec ON sec.id = ta.section_id
         LEFT JOIN subjects sub ON sub.id = ta.subject_id
         WHERE ta.teacher_id=$1`,
        [teacherId]
      );
      console.log(`Assignments for ${user.name}:`, assignmentsRes.rows);
    }
  }

  await client.end();
}

main().catch(console.error);
