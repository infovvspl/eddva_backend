const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  
  const batchId = '2099f7c4-9f66-4287-8621-f6dc8905fe82';
  console.log("Checking enrollments for batch:", batchId);

  const res = await dataSource.query(`SELECT * FROM enrollments WHERE batch_id = $1`, [batchId]);
  console.log("Enrollments:", res);

  await app.close();
}
test();
