const http = require('http');

const data = JSON.stringify({
  title: "Test",
  type: "topic_test",
  batchId: "73a1d9eb-1bc4-41d6-b08d-8a0bb3b37803",
  durationMinutes: 60,
  totalMarks: 20,
  deadlineAt: "2026-05-25T12:00:00.000Z",
  questionIds: ["1a3be906-c672-4b36-a199-4c8dcd376664"]
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/assessments/mock-tests',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + require('jsonwebtoken').sign({ sub: 'user123', role: 'super_admin' }, 'super-secret-key-for-jwt', { expiresIn: '1h' })
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(res.statusCode, body));
});

req.on('error', console.error);
req.write(data);
req.end();
