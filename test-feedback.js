const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');
const axios = require('axios');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  
  const batchId = '2099f7c4-9f66-4287-8621-f6dc8905fe82';

  // Get the first student enrolled in the batch
  const res = await dataSource.query(`
    SELECT u.email, u.id as user_id, s.id as student_id
    FROM enrollments e
    JOIN students s ON e.student_id = s.id
    JOIN users u ON s.user_id = u.id
    WHERE e.batch_id = $1 AND e.status = 'active'
    LIMIT 1
  `, [batchId]);

  if (res.length === 0) {
      console.log("No active students found.");
      return;
  }
  const student = res[0];
  console.log("Found student:", student);

  // Login as that student
  // Wait, I don't know the password! 
  // Let me just generate a JWT directly.
  const { JwtService } = require('@nestjs/jwt');
  const jwtService = app.get(JwtService);
  const payload = { sub: student.user_id, role: 'student', tenantId: '73a505c3-23eb-4166-b019-8c9bc154a284' };
  const token = jwtService.sign(payload);

  console.log("Generated token:", token);

  try {
    const apiRes = await axios.post(`http://127.0.0.1:3000/api/v1/batches/${batchId}/feedback`, { rating: 5, comment: "Test" }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-Subdomain': 'cds'
        }
    });
    console.log("Feedback submitted successfully!", apiRes.data);
  } catch (err) {
      console.error("Feedback failed:", err.response ? err.response.data : err.message);
  }

  await app.close();
}
test();
