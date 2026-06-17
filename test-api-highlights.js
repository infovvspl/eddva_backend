const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/school/materials/mock-id/highlights',
  method: 'GET',
  headers: {
    // We would need an auth token here to call the API...
  }
};
