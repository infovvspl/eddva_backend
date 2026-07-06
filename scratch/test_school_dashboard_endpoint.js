const http = require('http');

async function loginAndGetStats() {
  // 1. Login to get token
  const loginData = JSON.stringify({ email: 'superadmin@gmail.com', password: 'Admin@123' });
  
  const loginReq = http.request('http://localhost:3000/api/v1/school/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('Login Status:', res.statusCode);
      const parsed = JSON.parse(body);
      const token = parsed.token;
      if (!token) {
        console.error('Failed to get token:', parsed);
        return;
      }
      console.log('Token received! Testing /api/v1/school/dashboard/stats ...');

      // 2. Call GET /api/v1/school/dashboard/stats
      const statsReq = http.request('http://localhost:3000/api/v1/school/dashboard/stats', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, (statsRes) => {
        let statsBody = '';
        statsRes.on('data', chunk => statsBody += chunk);
        statsRes.on('end', () => {
          console.log('\nStats Endpoint Status:', statsRes.statusCode);
          console.log('Stats Response Body:', statsBody);
        });
      });

      statsReq.on('error', e => console.error('Stats Req Error:', e.message));
      statsReq.end();
    });
  });

  loginReq.on('error', e => console.error('Login Req Error:', e.message));
  loginReq.write(loginData);
  loginReq.end();
}

loginAndGetStats();
