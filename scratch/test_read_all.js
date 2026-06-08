const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const STUDENT_USER_ID = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54';

async function testReadAll() {
  const token = jwt.sign(
    { id: STUDENT_USER_ID, role: 'STUDENT', email: 'pratapdas@gmail.com', name: 'Pratap Das' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  try {
    console.log('Sending PATCH /school/notifications/read-all...');
    const response = await axios.patch(
      'http://localhost:3000/api/v1/school/notifications/read-all',
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    console.log('Response status:', response.status);
    console.log('Response body:', response.data);
  } catch (err) {
    console.error('Request failed:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

testReadAll();
