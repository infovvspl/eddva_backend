const axios = require('axios');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { AppModule } = require('./dist/app.module.js');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const jwtService = app.get(JwtService);
    
    // Create a super admin payload
    const payload = { sub: '00000000-0000-0000-0000-000000000000', email: 'admin@eddva.com', role: 'super_admin' };
    const token = jwtService.sign(payload);
    
    console.log('--- Calling /admin/stats endpoint ---');
    const response = await axios.get('http://localhost:3000/api/v1/admin/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(JSON.stringify(response.data, null, 2));

  } catch (err) {
    if (err.response) {
      console.error('API Error:', err.response.data);
    } else {
      console.error(err);
    }
  } finally {
    await app.close();
  }
}

run();
