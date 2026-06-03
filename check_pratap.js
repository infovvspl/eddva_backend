const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB successfully.");

    // Query Pratap
    const userRow = await client.query("SELECT * FROM users WHERE email='pratap.das@gmail.com'");
    console.log("USER ROW:", userRow.rows[0]);

    if (userRow.rows[0]) {
      const teacherRow = await client.query("SELECT * FROM teachers WHERE user_id=$1", [userRow.rows[0].id]);
      console.log("TEACHER PROFILE ROW:", teacherRow.rows[0]);

      if (teacherRow.rows[0]) {
        const assignments = await client.query("SELECT * FROM teacher_academic_assignments WHERE teacher_id=$1", [teacherRow.rows[0].id]);
        console.log("ACADEMIC ASSIGNMENTS:", assignments.rows);

        const classes = await client.query("SELECT * FROM teacher_classes WHERE teacher_id=$1", [teacherRow.rows[0].id]);
        console.log("TEACHER CLASSES:", classes.rows);

        const sections = await client.query("SELECT * FROM teacher_sections WHERE teacher_id=$1", [teacherRow.rows[0].id]);
        console.log("TEACHER SECTIONS:", sections.rows);

        const subjects = await client.query("SELECT * FROM teacher_subjects WHERE teacher_id=$1", [teacherRow.rows[0].id]);
        console.log("TEACHER SUBJECTS:", subjects.rows);
      }
    }

  } catch (err) {
    console.error("DB error:", err);
  } finally {
    await client.end();
  }
}

run();
