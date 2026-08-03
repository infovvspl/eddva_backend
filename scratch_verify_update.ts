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
    
    // 1. Get an existing teacher user
    const usersRes = await client.query(`
      SELECT u.id, u.name, u.email, u.institute_id 
      FROM users u 
      JOIN teachers t ON u.id = t.user_id 
      LIMIT 1
    `);
    
    if (usersRes.rows.length === 0) {
      console.log("No teachers found to test.");
      await client.end();
      await app.close();
      return;
    }

    const teacher = usersRes.rows[0];
    console.log("Found teacher to update:", teacher);

    const adminUser = {
      role: 'SUPER_ADMIN',
      instituteId: teacher.institute_id
    };

    // 2. Perform email update
    const originalEmail = teacher.email;
    const testNewEmail = `test_update_${Date.now()}@example.com`;

    console.log(`Updating teacher email from ${originalEmail} to ${testNewEmail}...`);
    const updateRes = await teacherService.update(adminUser, teacher.id, {
      name: teacher.name,
      email: testNewEmail
    });

    console.log("Update API result:", updateRes);

    // 3. Verify updated email in database
    const updatedUsersRes = await client.query(`SELECT email FROM users WHERE id = $1`, [teacher.id]);
    console.log("Updated email in database:", updatedUsersRes.rows[0]?.email);

    // 4. Revert change
    console.log(`Reverting email change back to ${originalEmail}...`);
    await teacherService.update(adminUser, teacher.id, {
      name: teacher.name,
      email: originalEmail
    });

    const revertedUsersRes = await client.query(`SELECT email FROM users WHERE id = $1`, [teacher.id]);
    console.log("Reverted email in database:", revertedUsersRes.rows[0]?.email);

  } catch (e) {
    console.error("Test failed with error:", e);
  } finally {
    await client.end();
  }

  await app.close();
}

test();
