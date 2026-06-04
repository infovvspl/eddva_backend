const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { BatchService } = require('./dist/modules/batch/batch.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const batchService = app.get(BatchService);
  
  const batchId = '2099f7c4-9f66-4287-8621-f6dc8905fe82';
  const userId = '68c93269-426b-4c10-bc9c-b533e468a3fb'; // User ID of the student
  const tenantId = '73a505c3-23eb-4166-b019-8c9bc154a284';

  try {
      const student = await batchService.getStudentByUserId(userId, tenantId);
      console.log("Student from Service:", student);
      
      const enrollment = await batchService.enrollmentRepo.findOne({
        where: { batchId, studentId: student.id, tenantId, status: 'active' }
      });
      console.log("Enrollment from Service:", enrollment);
  } catch (e) {
      console.error(e);
  }

  await app.close();
}
test();
