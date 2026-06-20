const axios = require('axios');
const jwt = require('jsonwebtoken');

async function testApi() {
  const teacherId = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
  const secret = 'your-super-secret-jwt-key-change-in-production';

  // The payload format needed for SchoolJwtGuard
  const payload = { id: teacherId, sub: teacherId, role: 'TEACHER' };
  const token = jwt.sign(payload, secret);

  console.log(`Token generated. Firing request to API...`);

  try {
    const res = await axios.get('http://localhost:3001/api/v1/school/notifications?category=attendance', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    console.log("=== API Response (Attendance) ===");
    console.log(`Status: ${res.status}`);
    console.log(`Response count: ${res.data.data.length}`);
    console.log(`Contains attendance_warning? ${res.data.data.some(d => d.type === 'attendance_warning')}`);
    
    const res2 = await axios.get('http://localhost:3001/api/v1/school/notifications?category=assignment', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log("\n=== API Response (Assignment) ===");
    console.log(`Status: ${res2.status}`);
    console.log(`Response count: ${res2.data.data.length}`);
    console.log(`Contains submission? ${res2.data.data.some(d => d.type === 'submission')}`);

    const res3 = await axios.get('http://localhost:3001/api/v1/school/notifications?category=live_class', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log("\n=== API Response (Live Class) ===");
    console.log(`Status: ${res3.status}`);
    console.log(`Response count: ${res3.data.data.length}`);
    console.log(`Contains meeting? ${res3.data.data.some(d => d.type === 'meeting')}`);

  } catch (err) {
    if (err.response) {
      console.error(`Error ${err.response.status}:`, err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

testApi();
