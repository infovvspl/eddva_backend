const http = require('http');

const data = JSON.stringify({
  targetType: 'CLASS',
  classId: 'a366246e-db01-4178-ab97-03f9367d70cb',
  sectionId: '366ce7b3-d609-4f33-86d4-b9145c8a816d',
  templateId: '46c7230d-2872-437f-abd7-a5c32cd1d92d'
});

const options = {
  hostname: 'localhost',
  port: 8080,
  path: '/api/v1/school/institute-admin/document/generate/id-card',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  let body = '';
  res.on('data', d => { body += d; });
  res.on('end', () => { console.log('Response:', body); });
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
