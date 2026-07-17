const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../src/app.module');
const { SchoolTeacherService } = require('../src/modules/school/teacher/school-teacher.service');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const svc = app.get(SchoolTeacherService);

  const id = '3d0eabde-0695-4935-9dd9-da21ae1dced8';
  const mockUser = { role: 'INSTITUTE_ADMIN', instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1' };

  try {
    const result = await svc.findOne(mockUser, id);
    console.log("Returned data from findOne service:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error in findOne service:", err);
  }

  await app.close();
}
run();
