const http = require('http');
const jwt = require('jsonwebtoken');

// Simulate a teacher login and create chapter
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

// Teacher user_id from users table: 526d9c0e-e2cd-4999-b1ec-a24646474796 (Pratap)
const token = jwt.sign({ id: '526d9c0e-e2cd-4999-b1ec-a24646474796', role: 'TEACHER' }, JWT_SECRET, { expiresIn: '1h' });

const payload = JSON.stringify({
  name: 'Verified Chapter Test',
  orderIndex: 1,
  subjectId: '6bda44a0-0523-42cc-90f6-97e50286b91e'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/school/topics/chapters',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(`HTTP ${res.statusCode}`);
    console.log(data);
  });
});

req.on('error', e => console.error('Request error:', e.message));
req.write(payload);
req.end();
