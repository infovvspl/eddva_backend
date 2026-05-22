const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.utiqzdnyrrprcdghqkgv:Subham@123@@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query("SELECT user_id FROM students WHERE id = '5532d95d-5d1a-4f4b-ae18-7cc978db026f'"))
  .then(res => {
    const userId = res.rows[0].user_id;
    console.log('User ID:', userId);
    
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({
      sub: userId,
      id: userId,
      role: 'student',
      tenantId: '73a505c3-23eb-4166-b019-8c9bc154a284'
    }, 'your-super-secret-jwt-key-change-in-production', { expiresIn: '1h' });
    
    const http = require('http');
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/v1/assessments/sessions/1719bdbd-2f9f-4983-8f80-2f9bc3ac1c5b/submit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    }, (httpRes) => {
      let body = '';
      httpRes.on('data', d => body += d);
      httpRes.on('end', () => console.log(httpRes.statusCode, body));
    });
    
    req.on('error', console.error);
    req.end();
    
    return client.end();
  })
  .catch(e => console.error(e.message));
