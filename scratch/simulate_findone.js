const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({ connectionString: process.env.SCHOOL_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const id = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
  
  let queryStr = `SELECT u.*,
            t.id AS teacher_profile_id,t.employee_id,t.blood_group,t.marital_status,t.department,t.joining_date,t.qualifications,
            t.education_details,t.experience_details,t.dob,t.gender,t.national_id,t.designation,t.salary,t.experience,
            t.address,t.city,t.state,t.pin_code,t.allergies,t.medical_conditions,t.documents,t.shift,t.weekdays,
            t.office_hours_start,t.office_hours_end,t.max_hours_per_week,t.emergency_contact,t.guardian_contact,
            t.disability,t.emergency_doctor,t.nationality,t.country,
     COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name)) FROM (SELECT DISTINCT class_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN classes c ON taa.class_id=c.id), '[]'::json) as classes,
     COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name)) FROM (SELECT DISTINCT section_id FROM teacher_academic_assignments WHERE teacher_id=t.id) taa JOIN sections s ON taa.section_id=s.id), '[]'::json) as sections,
     COALESCE((SELECT json_agg(json_build_object('id', sub.id, 'name', sub.name)) FROM (SELECT DISTINCT subject_id FROM teacher_academic_assignments WHERE teacher_id=t.id AND subject_id IS NOT NULL) taa JOIN subjects sub ON taa.subject_id=sub.id), '[]'::json) as subjects
     FROM users u LEFT JOIN teachers t ON t.user_id=u.id WHERE (u.id=$1 OR t.id=$1) AND (u.role LIKE '%TEACHER%' OR u.role LIKE '%INSTITUTE_ADMIN%')`;

  const res = await c.query(queryStr, [id]);
  console.log("Database Row:", JSON.stringify(res.rows[0], null, 2));

  await c.end();
}
run();
