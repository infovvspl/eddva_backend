const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { SchoolSubjectService } = require('./dist/modules/school/subject/school-subject.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const subjectService = app.get(SchoolSubjectService);

  const studentUser = {
    role: 'STUDENT',
    instituteId: 'c259cd4e-b018-45e2-8e46-52a497ca49a1'
  };

  const classId = '247a5e6f-555a-466a-b560-8604bcf35b0c'; // Class 9

  try {
    const res = await subjectService.list(studentUser, { classId, limit: 100 });
    console.log("Subjects list response:");
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e);
  }

  await app.close();
}
test();
