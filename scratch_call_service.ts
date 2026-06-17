import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SchoolReportService } from './src/modules/school/report/school-report.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(SchoolReportService);

  const mockUser = {
    id: '3d0eabde-0695-4935-9dd9-da21ae1dced8', // Pratap kumar Das user_id
    role: 'TEACHER',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1',
  };

  const mockQuery = {};

  try {
    console.log('Calling classReport...');
    const result = await service.classReport(mockUser, mockQuery);
    console.log('\nResult from service:');
    console.log(JSON.stringify(result.data, null, 2));
  } catch (err) {
    console.error('Error calling service:', err);
  } finally {
    await app.close();
  }
}

run();
