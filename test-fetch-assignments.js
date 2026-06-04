const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { AssignmentService } = require('./dist/modules/assignment/assignment.service');

async function testFetch() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(AssignmentService);
  
  // Use the real tenant ID from the DB
  const tenantId = '73a505c3-23eb-4166-b019-8c9bc154a284';
  const lectureId = '7e125cc4-4c20-4914-b9b8-4979cbab290c';
  
  try {
    const result = await service.getAssignmentsForLecture(tenantId, lectureId, undefined);
    console.log('Assignments:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
  await app.close();
}

testFetch();
