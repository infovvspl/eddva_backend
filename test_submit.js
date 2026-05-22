const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/assessments/sessions/1719bdbd-2f9f-4983-8f80-2f9bc3ac1c5b/submit',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + require('jsonwebtoken').sign({ sub: '5532d95d-5d1a-4f4b-ae18-7cc978db026f', role: 'student' }, 'super-secret-key-for-jwt', { expiresIn: '1h' })
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(res.statusCode, body));
});

req.on('error', console.error);
req.end();
