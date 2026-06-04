const { Client } = require('pg');

async function testQueries() {
  const schoolUrl = "postgresql://postgres.mrirhbcfxpcmcnvrzfld:itEVbOANeXg71Gcw@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  const client = new Client({ connectionString: schoolUrl });
  try {
    await client.connect();
    
    // Find a sample institute ID first
    const instRes = await client.query("SELECT id FROM institutes LIMIT 1");
    const instituteId = instRes.rows[0]?.id;
    console.log("Using instituteId:", instituteId);
    
    if (!instituteId) {
      console.log("No institute found to run tests against.");
      return;
    }

    console.log("\n--- Testing SchoolStudentService.list SQL ---");
    try {
      const studentSql = `
        SELECT u.id,u.name,u.email,u.phone,u.is_active,u.photo,u.created_at,
               s.id AS profile_id,s.enrollment_no,s.roll_no,s.section_id,s.dob,s.gender,s.blood_group,
               s.father_name,s.mother_name,s.parent_phone,s.admission_date,
               sec.name AS section_name,c.name AS class_name
        FROM users u JOIN students s ON s.user_id=u.id
        LEFT JOIN sections sec ON s.section_id=sec.id
        LEFT JOIN classes c ON sec.class_id=c.id
        WHERE u.institute_id=$1 AND u.role='STUDENT' ORDER BY u.name
      `;
      const res = await client.query(studentSql, [instituteId]);
      console.log("SUCCESS! Student list query returned rows:", res.rows.length);
    } catch (e) {
      console.error("FAILED! Student list query error:", e.message);
    }

    console.log("\n--- Testing SchoolEventService.list SQL ---");
    try {
      const eventSql = `
        SELECT id, institute_id AS "instituteId", title, description, category, 
               start_time AS "startTime", end_time AS "endTime", 
               is_all_day AS "isAllDay", location, priority, 
               created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM events 
        WHERE institute_id=$1 AND start_time >= $2 AND start_time <= $3 
        ORDER BY start_time ASC
      `;
      const res = await client.query(eventSql, [instituteId, new Date('2026-06-01'), new Date('2026-06-07')]);
      console.log("SUCCESS! Event list query returned rows:", res.rows.length);
    } catch (e) {
      console.error("FAILED! Event list query error:", e.message);
    }

  } catch (err) {
    console.error("Connection error:", err);
  } finally {
    await client.end();
  }
}

testQueries();
