const http = require('http');
const req = http.request({ port: 3000, host: '127.0.0.1', path: '/api/v1/school/auth/me', method: 'GET' }, (res) => {
  console.log('STATUS:', res.statusCode);
  process.exit(0);
});
req.on('error', (err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
req.end();
