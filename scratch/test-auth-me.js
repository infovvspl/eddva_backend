const axios = require('axios');

async function main() {
  const loginRes = await axios.post('http://localhost:3000/api/v1/school/auth/login', {
    email: 'aps@gmail.com',
    password: 'password123'
  });
  const token = loginRes.data.token;
  console.log('Token:', token);

  const meRes = await axios.get('http://localhost:3000/api/v1/school/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('Me Response:', JSON.stringify(meRes.data, null, 2));
}

main().catch(console.error);
