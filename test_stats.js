const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module.js');
const { SuperAdminService } = require('./dist/modules/super-admin/super-admin.service.js');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(SuperAdminService);
  const stats = await service.getPlatformStats();
  console.log(JSON.stringify(stats.studentFocus, null, 2));
  await app.close();
}
bootstrap().catch(console.error);
