import axios from 'axios';

async function run() {
  try {
    // We need to bypass auth or pass a token. But 400 is usually from class-validator, which runs before auth if auth is global, or maybe it fails at auth?
    // Wait, 400 Bad Request is returned before 401 Unauthorized if ValidationPipe is global.
    // Let's just make the request and see what it says.
    const res = await axios.post('http://localhost:8080/api/v1/school/institute-admin/document/generate/id-card', {
      targetType: 'INDIVIDUAL',
      studentIds: ['1c76fda5-a745-4328-bb01-0be969fcfc29'],
      templateId: '46c7230d-2872-437f-abd7-a5c32cd1d92d'
    });
    console.log(res.status, res.data);
  } catch (err: any) {
    console.log(err.response?.status);
    console.log(err.response?.data);
  }
}

run();
