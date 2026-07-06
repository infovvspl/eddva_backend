const jwt = require('jsonwebtoken');
const http = require('http');
require('dotenv').config();

const secret = process.env.SCHOOL_JWT_SECRET || `school:${process.env.JWT_SECRET || 'fallback'}`;

const payload = {
  id: '869f1b3a-8758-4d9d-92a1-d6c0b2f0511f',
  role: 'INSTITUTE_ADMIN',
  email: 'teas6487@gmail.com',
  tenantType: 'school',
  instituteId: 'e9f3592d-851a-43be-9361-574e57722703',
  sessionId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
};

const token = jwt.sign(payload, secret, { expiresIn: '1h' });

console.log('Generated Admin JWT Token. Calling GET /api/v1/school/dashboard/stats ...');

const req = http.request('http://localhost:3000/api/v1/school/dashboard/stats', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:', body);
  });
});

req.on('error', e => console.error('Req Error:', e.message));
req.end();
