import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource);
  
  const studentsCount = await ds.query(`SELECT count(*)::int as count FROM students`);
  console.log('--- Total students in database:', studentsCount[0].count);
  
  const students = await ds.query(`
    SELECT u.id, u.name, u.email, u.role, u.is_active, s.enrollment_no, s.roll_no
    FROM users u JOIN students s ON s.user_id=u.id
  `);
  console.log('--- Students list in DB:');
  console.log(students);
  
  await app.close();
}
run();
