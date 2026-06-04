const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { BatchService } = require('./dist/modules/batch/batch.service');
const { getRepositoryToken } = require('@nestjs/typeorm');
const { Tenant } = require('./dist/database/entities/tenant.entity');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const tenantRepo = app.get(getRepositoryToken(Tenant));
    const tenant = await tenantRepo.findOne({ where: { subdomain: 'cds' } });
    
    if (!tenant) throw new Error("Tenant not found");
    const tenantId = tenant.id;
    console.log("Found tenant:", tenantId);

    const batchService = app.get(BatchService);
    const batches = await batchService.getBatches({}, { role: 'SUPER_ADMIN' }, tenantId);
    console.log("Success! Found", batches.length, "batches.");
    if (batches.length > 0) {
        console.log("First batch:", batches[0].name);
    }
  } catch (err) {
    console.error("ERROR:", err);
  }
  await app.close();
}
bootstrap();
