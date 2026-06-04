const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { DataSource } = require('typeorm');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  try {
    console.log("Synchronizing database...");
    await dataSource.synchronize(false);
    console.log("Database synchronized successfully!");
  } catch (e) {
    console.error("Failed to synchronize database", e);
  }

  await app.close();
}

run();
