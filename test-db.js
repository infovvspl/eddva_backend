const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');
const { LectureAssignment } = require('./dist/database/entities/assignment.entity');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  try {
    const repo = dataSource.getRepository(LectureAssignment);
    const data = await repo.find({ where: { lectureId: "7e125cc4-4c20-4914-b9b8-4979cbab290c", tenantId: "some-tenant" }});
    console.log("Success:", data);
  } catch (e) {
    console.error("DB Error:", e);
  }

  await app.close();
}

run();
