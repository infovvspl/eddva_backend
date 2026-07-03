const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: __dirname + '/../.env' });

async function run() {
  const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
  const secret = process.env.SCHOOL_JWT_SECRET || 'school:your-super-secret-jwt-key-change-in-production';
  
  const payload = { id: teacherId, sub: teacherId, role: 'TEACHER', instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1' };
  const token = jwt.sign(payload, secret);

  const classId = '0f7f82d0-2bc9-4002-b8b5-62c4bf06f2f1';
  const sectionId = '5e3ac02b-7113-47df-9d02-7f3e761ca252';

  // Let's first fetch all students in this section to build a payload
  const port = process.env.PORT || 3001; // try 3000
  let url = `http://localhost:3000/api/v1/school/attendance/students`;
  let students = [];
  try {
    const res = await axios.get(url, {
      params: { classId, sectionId, page: 1, limit: 2000 },
      headers: { Authorization: `Bearer ${token}` }
    });
    students = res.data.data;
  } catch (err) {
    console.error("Failed to get students:", err.message);
    return;
  }

  console.log(`Loaded ${students.length} students. Sending POST request to mark session attendance...`);

  const postUrl = `http://localhost:3000/api/v1/school/attendance/session`;
  const postBody = {
    classId,
    sectionId,
    subjectId: null,
    period: 'Period 1 (08:00 - 08:45)',
    date: '2026-07-04',
    finalized: true,
    students: students.map(s => ({
      student_id: s.id,
      status: 'present',
      remarks: 'Test post attendance'
    }))
  };

  try {
    const res = await axios.post(postUrl, postBody, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("SUCCESS! Response:", res.data);
  } catch (err) {
    if (err.response) {
      console.error(`Error ${err.response.status}:`, err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

run().catch(console.error);
