import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolAssignmentService } from './src/modules/school/assignment/school-assignment.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(SchoolAssignmentService);

  try {
    const user = {
      id: 'a0d51659-5768-4f64-b45b-cc2688fe29a7', // mock
      role: 'TEACHER',
      tenantId: 'a0d51659-5768-4f64-b45b-cc2688fe29a7', // From DB
      instituteId: '11111111-1111-1111-1111-111111111111'
    };
    const body = {
      title: 'Integration Test Assignment',
      type: 'homework',
      classId: '00000000-0000-0000-0000-000000000000',
      subjectId: '00000000-0000-0000-0000-000000000000'
    };

    const res = await service.create(user, body);
    console.log('API POST STATUS: 201');
    console.log('INSERTED ID:', res.data.id);
  } catch (e) {
    console.error('API Error:', e.message);
  }

  await app.close();
}
bootstrap();
