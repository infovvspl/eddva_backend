const http = require('http');

http.get('http://localhost:3000/api/v1/admin/stats', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Status Code:', res.statusCode);
      console.log('studentFocus:', json.data?.studentFocus || json.studentFocus);
      console.log('Full response keys:', Object.keys(json.data || json));
    } catch(e) {
      console.error('Error parsing JSON:', data);
    }
  });
}).on('error', (err) => {
  console.error('Request Error:', err.message);
});
