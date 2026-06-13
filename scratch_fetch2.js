const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/school/gamification/memory-match/leaderboard',
  method: 'GET',
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Body:", data);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
