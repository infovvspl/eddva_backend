const http = require('http');

http.get('http://localhost:3000/docs-json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      const swagger = JSON.parse(data);
      const paths = Object.keys(swagger.paths);
      const memoryPaths = paths.filter(p => p.includes('memory'));
      console.log('Memory Match Paths:', memoryPaths);
    } else {
      console.log('Status:', res.statusCode);
    }
  });
});
