const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { AppModule } = require('./dist/app.module.js');
const axios = require('axios');
const { DataSource } = require('typeorm');

function extractData(response) {
  const d = response.data;
  if (d && typeof d === 'object' && 'data' in d) {
    return d.data;
  }
  return d;
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const dataSource = app.get(DataSource);
    const jwtService = app.get(JwtService);

    const res = await dataSource.query(`SELECT id, email FROM users WHERE role = 'super_admin' AND status = 'active' LIMIT 1`);
    if (res.length === 0) {
      console.log('No super admin found');
      return;
    }
    const admin = res[0];
    const payload = { sub: admin.id, email: admin.email, role: 'super_admin' };
    const token = jwtService.sign(payload);

    console.log('--- 1. Calling /admin/stats endpoint ---');
    const response = await axios.get('http://localhost:3000/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('\n--- 2. Raw JSON Response (response.data) ---');
    console.log(JSON.stringify(response.data, null, 2));

    console.log('\n--- 3. Extracted Stats Object (extractData(response)) ---');
    const stats = extractData(response);
    
    console.log('\n--- 4. Checking Data Loss ---');
    console.log('stats.studentFocus exists?', !!stats.studentFocus);
    console.log('stats.studentFocus:', JSON.stringify(stats.studentFocus, null, 2));

  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) console.error(err.response.data);
  } finally {
    await app.close();
  }
}

run();
