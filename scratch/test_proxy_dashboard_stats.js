const http = require('http');

async function testProxy() {
  const loginData = JSON.stringify({ email: 'superadmin@gmail.com', password: 'Admin@123' });

  const portsToTest = [8080, 8081];

  for (const port of portsToTest) {
    console.log(`\n=== Testing port ${port} ===`);
    try {
      const loginReq = http.request(`http://localhost:${port}/api/v1/school/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log(`Port ${port} Login Status:`, res.statusCode);
          try {
            const parsed = JSON.parse(body);
            const token = parsed.token;
            if (!token) return;

            const statsReq = http.request(`http://localhost:${port}/api/v1/school/dashboard/stats`, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}` }
            }, (statsRes) => {
              let statsBody = '';
              statsRes.on('data', chunk => statsBody += chunk);
              statsRes.on('end', () => {
                console.log(`Port ${port} Stats Status:`, statsRes.statusCode);
                console.log(`Port ${port} Stats Response:`, statsBody.substring(0, 300));
              });
            });
            statsReq.end();
          } catch (e) {}
        });
      });
      loginReq.on('error', e => console.error(`Port ${port} Error:`, e.message));
      loginReq.write(loginData);
      loginReq.end();
    } catch (e) {
      console.error(`Port ${port} Exception:`, e.message);
    }
  }
}

testProxy();
