import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds: DataSource = app.get(getDataSourceToken('school'));
  
  const teacherQuery = `
    SELECT u.name, u.email, t.qualifications, t.nationality, t.address, t.city, t.state, t.country, t.pin_code
    FROM users u
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE u.name ILIKE '%Pratap%';
  `;
  
  const result = await ds.query(teacherQuery);
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
run();
