const http = require('http');

function testLogin(email, password) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const req = http.request('http://localhost:3000/api/v1/super-admin/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`\n=== Testing ${email} / ${password} ===`);
        console.log('Status Code:', res.statusCode);
        console.log('Response Body:', body);
        resolve(res.statusCode);
      });
    });

    req.on('error', (e) => {
      console.error('HTTP Request Error:', e.message);
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  await testLogin('superadmin@gmail.com', 'Admin@123');
  await testLogin('superadmin@gmail.com', 'change_this_in_production');
  await testLogin('admin@edva.in', 'change_this_in_production');
  await testLogin('admin@edva.in', 'Admin@123');
}

run();
