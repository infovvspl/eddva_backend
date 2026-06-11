const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
  const client = new Client({
    connectionString: process.env.SCHOOL_DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  const students = [
    { name: 'John Doe', user_id: 'a0a4218b-c1a4-433e-b9fb-404d8a9783e0' },
    { name: 'Pratap Das', user_id: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54' },
    { name: 'student1', user_id: '49f80313-0744-465c-a79d-f22eb176fb97' }
  ];

  const resultsToSeed = [
    // 1. Socialism in Europe and the Russian Revolution (topic ID: 5786c6ee-000f-4d4b-a522-6bf69604d50b)
    {
      assessment_id: 'ab715b5d-2f72-415f-a7b4-366bd1b31be2',
      percentage: 35.00,
      marks_obtained: 35,
      total_marks: 100,
      grade: 'D'
    },
    // 2. Nazism and the Rise of Hitler (topic ID: 334f8c90-b7b2-4224-9457-72ba8f51cfc3)
    {
      assessment_id: 'f24666ac-7dd7-4528-8cdf-583d1d13d733',
      percentage: 20.00,
      marks_obtained: 20,
      total_marks: 100,
      grade: 'E'
    }
  ];

  try {
    await client.connect();
    console.log("Connected successfully to database!");

    for (const stud of students) {
      console.log(`Seeding results for student: ${stud.name} (${stud.user_id})`);
      for (const res of resultsToSeed) {
        await client.query(`
          INSERT INTO results
            (assessment_id, student_id, total_marks, marks_obtained, percentage, is_absent, grade, remarks, status)
          VALUES ($1, $2, $3, $4, $5, false, $6, 'Seeded low accuracy for testing', 'published')
          ON CONFLICT (assessment_id, student_id) DO UPDATE SET
            total_marks = EXCLUDED.total_marks,
            marks_obtained = EXCLUDED.marks_obtained,
            percentage = EXCLUDED.percentage,
            grade = EXCLUDED.grade,
            remarks = EXCLUDED.remarks,
            status = 'published',
            updated_at = NOW()
        `, [res.assessment_id, stud.user_id, res.total_marks, res.marks_obtained, res.percentage, res.grade]);
      }
    }
    console.log("Seeding completed successfully!");

  } catch (err) {
    console.error("Error during seeding:", err.stack);
  } finally {
    await client.end();
  }
}

run();
