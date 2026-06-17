const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    
    // Select all slots for Pratap kumar Das
    const res = await clientSchool.query(`
      SELECT t.id, t.day_of_week, t.start_time, t.end_time, t.period_number,
             sub.name as subject, sec.name as section, c.name as class_name
      FROM timetables t
      LEFT JOIN subjects sub ON t.subject_id = sub.id
      LEFT JOIN sections sec ON t.section_id = sec.id
      LEFT JOIN classes c ON sec.class_id = c.id
      WHERE t.teacher_id = '15f29a6d-2215-4f7c-b4ce-49d92104c28f'
      ORDER BY t.day_of_week, t.start_time
    `);
    console.log("Timetable slots for Pratap kumar Das:\n", res.rows);

    await clientSchool.end();
  } catch (e) {
    console.error("Error:", e);
  }
}

run();
