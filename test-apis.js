const http = require('http');

const teacherToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjNkMGVhYmRlLTA2OTUtNDkzNS05ZGQ5LWRhMjFhZTFkY2VkOCIsInJvbGUiOiJURUFDSEVSIiwiaW5zdGl0dXRlSWQiOiJjMjU5Y2Q0ZS1iMDE4LTQ1ZTItOGU0Ni01MmE0OTdjYTQ5YTEiLCJpYXQiOjE3ODEwODU0NTQsImV4cCI6MTc4MTA4OTA1NH0.5B7lEHzTVIYakHawu5qEOvjLYNkwMchpQ4Vo0K5azSk';
const studentToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImI0OWVlOGQzLTRjMzMtNDQ4Yy1hYTA2LTMwZGM4YmZiZWU1NCIsInJvbGUiOiJTVFVERU5UIiwiaW5zdGl0dXRlSWQiOiJjMjU5Y2Q0ZS1iMDE4LTQ1ZTItOGU0Ni01MmE0OTdjYTQ5YTEiLCJpYXQiOjE3ODEwODU0NTQsImV4cCI6MTc4MTA4OTA1NH0.2MrCsZKFNCXatEx_hyBjTLZMsC5-OUqJbAGU1pxaZDM';

function makeRequest(path, token, name) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`\n=== Response from ${name} API ===`);
        console.log(data);
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      resolve();
    });

    req.end();
  });
}

async function run() {
  await new Promise(r => setTimeout(r, 20000)); // wait for server to start
  console.log("Making requests...");
  await makeRequest('/api/v1/school/dashboard/stats', teacherToken, 'Teacher Dashboard');
  await makeRequest('/api/v1/school/students/dashboard', studentToken, 'Student Dashboard');
}

run();
