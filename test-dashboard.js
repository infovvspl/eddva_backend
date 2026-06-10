const jwt = require('jsonwebtoken');
const axios = require('axios');

async function test() {
  const secret = 'your-super-secret-jwt-key-change-in-production';
  // Payload for a student user. Usually it has id, role.
  const payload = {
    id: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54',
    role: 'STUDENT',
    instituteId: 'some-institute-id' // if needed
  };

  const token = jwt.sign(payload, secret);
  console.log("Generated token:", token);

  try {
    const res = await axios.get('http://localhost:3000/api/v1/school/students/dashboard', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("Dashboard response data:");
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("API Error:", err.response ? err.response.data : err.message);
  }
}

test();
