const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const STUDENT_USER_ID = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54';

async function testNewRoutes() {
  const token = jwt.sign(
    { id: STUDENT_USER_ID, role: 'STUDENT', email: 'pratapdas@gmail.com', name: 'Pratap Das' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 1. Get Preferences
    console.log('Testing GET /school/notifications/preferences...');
    const prefGet = await axios.get('http://localhost:3000/api/v1/school/notifications/preferences', { headers });
    console.log('GET Preferences Response:', prefGet.data);

    // 2. Put Preferences
    console.log('\nTesting PUT /school/notifications/preferences...');
    const prefPut = await axios.put('http://localhost:3000/api/v1/school/notifications/preferences', {
      enableInApp: true,
      enableEmail: false, // turn off email for testing
      enablePush: true,
      assignmentAlerts: true,
      assessmentAlerts: false
    }, { headers });
    console.log('PUT Preferences Response:', prefPut.data);

    // Verify change persisted
    console.log('\nTesting GET preferences again to verify...');
    const prefGet2 = await axios.get('http://localhost:3000/api/v1/school/notifications/preferences', { headers });
    console.log('GET Preferences (Updated):', prefGet2.data);

    // 3. Test Bulk Read
    console.log('\nTesting PATCH /school/notifications/bulk-read...');
    const bulkReadRes = await axios.patch('http://localhost:3000/api/v1/school/notifications/bulk-read', {
      ids: ['555bb47c-703c-4e4b-9a7f-60e8e330bdc2'] // dummy or real uuid
    }, { headers });
    console.log('Bulk Read Response:', bulkReadRes.data);

    // 4. Test Bulk Delete
    console.log('\nTesting DELETE /school/notifications/bulk-delete...');
    const bulkDelRes = await axios.delete('http://localhost:3000/api/v1/school/notifications/bulk-delete', {
      data: { ids: ['555bb47c-703c-4e4b-9a7f-60e8e330bdc2'] },
      headers
    });
    console.log('Bulk Delete Response:', bulkDelRes.data);

    console.log('\n🎉 ALL NEW BACKEND ROUTES TESTED SUCCESSFULLY!');
  } catch (err) {
    console.error('Request failed:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

testNewRoutes();
