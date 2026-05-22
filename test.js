const fetch = require('node-fetch');

async function test() {
  try {
    const loginRes = await fetch('http://127.0.0.1:3000/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Subdomain': 'cds'
      },
      body: JSON.stringify({ email: 'admin@codingschool.com', password: 'password123' })
    });
    const loginData = await loginRes.json();
    if (!loginData.data) {
        console.log("Login failed", loginData);
        return;
    }
    const token = loginData.data.accessToken;

    const batchesRes = await fetch('http://127.0.0.1:3000/api/v1/batches', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Tenant-Subdomain': 'cds'
      }
    });
    console.log("Status:", batchesRes.status);
    const batches = await batchesRes.text();
    console.log(batches.substring(0, 500));
  } catch (err) {
      console.error(err);
  }
}
test();
