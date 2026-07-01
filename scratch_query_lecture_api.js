const jwt = require('jsonwebtoken');
const axios = require('axios');

async function test() {
  const secret = 'your-super-secret-jwt-key-change-in-production';
  const payload = {
    sub: 'da39566f-a10c-4168-91dd-9b119723b3c7', // Subham Mishra User ID
    role: 'student',
    tenantId: '73a505c3-23eb-4166-b019-8c9bc154a284'
  };

  const token = jwt.sign(payload, secret);

  const instance = axios.create({
    baseURL: 'http://localhost:3000/api/v1',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Tenant-Subdomain': 'cds'
    }
  });

  try {
    const res = await instance.get('/assessments/progress/topic/a211af56-9fab-471f-80fb-dfd438a840ad');
    console.log("Topic Progress Response Status:", res.status);
    console.log("Topic Progress Response Data:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error("Topic Progress Error Response Status:", err.response.status);
      console.error("Topic Progress Error Response Data:", err.response.data);
    } else {
      console.error("Network Error:", err.message);
    }
  }
}

test();
