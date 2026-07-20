import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolTeacherService } from './src/modules/school/teacher/school-teacher.service';
import { Client } from 'pg';

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const teacherService = app.get(SchoolTeacherService);

  const client = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Get teacher email
    const usersRes = await client.query(`
      SELECT u.id, u.name, u.email, u.institute_id 
      FROM users u 
      WHERE u.id = 'e2840eda-64d3-4a41-ab01-48c76a610ee9'
    `);
    
    console.log("Teacher in database:", usersRes.rows);

    const teacher = usersRes.rows[0] || { id: 'e2840eda-64d3-4a41-ab01-48c76a610ee9', institute_id: 'eadac06f-cebd-4d70-9a6e-52959e541896' };

    const adminUser = {
      role: 'SUPER_ADMIN',
      instituteId: teacher.institute_id
    };

    console.log("Calling update...");
    const updateRes = await teacherService.update(adminUser, 'e2840eda-64d3-4a41-ab01-48c76a610ee9', {
      name: teacher.name || 'Anil Mishra',
      email: 'anil.mishra@colvin.com'
    });

    console.log("Update result:", updateRes);

  } catch (e) {
    console.error("Caught error:", e);
  } finally {
    await client.end();
  }

  await app.close();
}

test();
