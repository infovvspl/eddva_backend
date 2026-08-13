const http = require('http');

const teacherToken = process.env.TEACHER_TOKEN || '';
const studentToken = process.env.STUDENT_TOKEN || '';

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
