const http = require('http');

const data = JSON.stringify({
  email: 'superadmin@gmail.com',
  password: 'Admin@123'
});

const req = http.request('http://localhost:3000/api/v1/school/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', body);
  });
});

req.on('error', (e) => {
  console.error('HTTP Request Error:', e.message);
});

req.write(data);
req.end();
