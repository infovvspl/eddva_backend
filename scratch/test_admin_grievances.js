const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const ADMIN_ID = '5a3a02f9-94fb-4db8-b219-f8ac39006d2d'; // Subham Mishra
const INST_ID = 'c259cd4e-b018-45e2-8e46-52a497ca49a1';

function getToken(userId, role, email, name) {
  return jwt.sign(
    { id: userId, role, email, name, instituteId: INST_ID },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function run() {
  const adminToken = getToken(ADMIN_ID, 'INSTITUTE_ADMIN', 'odm@gmail.com', 'Subham Mishra');
  const headers = { Authorization: `Bearer ${adminToken}` };

  console.log('--- Fetching grievances as Institute Admin ---');
  try {
    const res = await axios.get('http://localhost:3000/api/v1/school/grievances', { headers });
    console.log('Status Code:', res.status);
    console.log('Grievances List count:', res.data.data.length);
    res.data.data.forEach(g => {
      console.log(`- Title: "${g.title}", Raised By: ${g.raised_by_name} (${g.raised_by_role}), Category: ${g.category}, Status: ${g.status}`);
    });
  } catch (err) {
    console.error(err.message);
    if (err.response) {
      console.error(err.response.data);
    }
  }
}

run();
