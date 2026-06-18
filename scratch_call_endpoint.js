const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./src/app.module');
const { SchoolReportService } = require('./src/modules/school/report/school-report.service');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(SchoolReportService);

  const mockUser = {
    id: '3d0eabde-0695-4935-9dd9-da21ae1dced8', // Pratap's user_id
    role: 'ADMIN',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1',
  };

  const mockQuery = { teacherUserId: '3d0eabde-0695-4935-9dd9-da21ae1dced8' };

  try {
    console.log('Calling classReport...');
    const result = await service.classReport(mockUser, mockQuery);
    console.log('\nResult from service:');
    console.log('Summary:', result.summary);
    console.log('Class Analytics:', result.data);
    console.log('Students Sample:', result.students.slice(0, 5));
    console.log('Scope:', result.scope);
  } catch (err) {
    console.error('Error calling service:', err);
  } finally {
    await app.close();
  }
}

run();
