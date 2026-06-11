const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  const ds = {
    query: (sql, params) => client.query(sql, params).then(res => res.rows)
  };

  const instituteId = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';
  const teacherId = '15f29a6d-2215-4f7c-b4ce-49d92104c28f';

  // TEACHER DASHBOARD LOGIC
  const todayStr = new Date().toISOString().split('T')[0];
  const dayNum = new Date().getDay();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const dayOfWeekStr = days[dayNum];
  const mappedDayOfWeek = String(dayNum === 0 ? 7 : dayNum);

  const schedules = await ds.query(`
          SELECT t.id, t.start_time, t.end_time, t.room, t.type as class_type,
                 c.name as class_name, sub.name as subject_name
          FROM timetables t 
          LEFT JOIN sections sec ON t.section_id = sec.id
          LEFT JOIN classes c ON sec.class_id = c.id 
          LEFT JOIN subjects sub ON t.subject_id = sub.id 
          WHERE t.teacher_id = $1 AND t.day_of_week = $2 
          ORDER BY t.start_time LIMIT 6
        `, [teacherId, mappedDayOfWeek]);

  console.log("=== Teacher Dashboard ===");
  console.log("Teacher ID:", teacherId);
  console.log("Today's Day:", mappedDayOfWeek);
  console.log("Calculated Day:", dayOfWeekStr);
  console.log("Today's Classes:", schedules);

  // STUDENT DASHBOARD LOGIC
  const studentProfileId = 'b1029c7b-7bce-4db2-bdc4-6c39f0db87b3'; // Not exact, but we have sectionId
  const sectionId = '73642c31-2820-4578-9a2c-9bdbdd95df1e';
  
  const timetablesRows = await ds.query(
    `SELECT t.id, t.start_time, t.end_time, t.room, t.type, sub.name AS subject_name, u.name AS teacher_name
     FROM timetables t
     LEFT JOIN subjects sub ON t.subject_id=sub.id
     LEFT JOIN teachers teach ON t.teacher_id=teach.id
     LEFT JOIN users u ON teach.user_id=u.id
     WHERE t.section_id=$1 AND t.day_of_week=$2
     ORDER BY t.start_time`,
    [sectionId, mappedDayOfWeek],
  );

  console.log("\n=== Student Dashboard ===");
  console.log("Student User:", { id: 'test_user_id' });
  console.log("Student Class:", '247a5e6f-555a-466a-b560-8604bcf35b0c');
  console.log("Student Section:", sectionId);
  console.log("Calculated Day:", dayOfWeekStr);
  console.log("Today's Classes:", timetablesRows);

  client.end();
}

run().catch(console.error);
