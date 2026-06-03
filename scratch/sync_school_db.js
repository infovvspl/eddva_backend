const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { getDataSourceToken } = require('@nestjs/typeorm');

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const token = getDataSourceToken('school');
    console.log("School DB token:", token);
    const dataSource = app.get(token);
    console.log("School DB DataSource retrieved!");
    
    console.log("Synchronizing School database...");
    await dataSource.synchronize(false);
    console.log("School database synchronized successfully!");
  } catch (e) {
    console.error("Failed to synchronize School database", e);
  } finally {
    await app.close();
  }
}

run();
