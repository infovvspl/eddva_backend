const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

async function run() {
  const secret = process.env.JWT_SECRET || 'dev_secret_change_in_prod';
  // Pratap Das STUDENT user ID in School DB
  const payload = {
    id: 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54',
    role: 'STUDENT',
    email: 'pratapdas@gmail.com',
    tenantType: 'school'
  };

  const token = jwt.sign(payload, secret, { expiresIn: '7d' });
  console.log('Signed Token:', token);

  const url = 'http://localhost:3000/api/v1/school/students/courses/my';
  console.log('Sending request to:', url);

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('Status Code:', res.status);
    console.log('Response:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.log('Response error Status Code:', err.response.status);
      console.log('Response error data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Request error:', err.message);
    }
  }
}

run();
