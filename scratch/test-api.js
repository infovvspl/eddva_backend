const axios = require('axios');

async function test() {
  console.log('Testing dev-api.eddva.in platform-config...');
  try {
    const res = await axios.get('https://dev-api.eddva.in/api/v1/tenants/public/platform-config?vertical=coaching');
    console.log('Status:', res.status);
    console.log('Data (truncated):', JSON.stringify(res.data).slice(0, 300));
  } catch (err) {
    console.error('Error fetching platform config:', err.message);
  }
}

test();
