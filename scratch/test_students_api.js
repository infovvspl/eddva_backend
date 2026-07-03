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

  const port = process.env.PORT || 3001; // try both 3000 and 3001
  const urls = [
    `http://localhost:3000/api/v1/school/attendance/students`,
    `http://localhost:3001/api/v1/school/attendance/students`
  ];

  for (const url of urls) {
    try {
      console.log(`Firing request to ${url}...`);
      const res = await axios.get(url, {
        params: {
          classId,
          sectionId,
          page: 1,
          limit: 2000
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      console.log(`SUCCESS! Status: ${res.status}`);
      console.log(`Returned student count: ${res.data.data.length}`);
      console.log(`Total count reported: ${res.data.total}`);
      console.log(`Limit used: ${res.data.limit}`);
      break;
    } catch (err) {
      if (err.response) {
        console.error(`Error ${err.response.status}:`, err.response.data);
      } else {
        console.error(err.message);
      }
    }
  }
}

run().catch(console.error);
