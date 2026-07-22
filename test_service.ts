import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SuperAdminService } from './src/modules/super-admin/super-admin.service';
import { AnnouncementCategory, AnnouncementPriority } from './src/modules/super-admin/dto/announcement.enums';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(SuperAdminService);
  
  console.log('1. Creating announcement with EMERGENCY and URGENT...');
  const created = await service.createAnnouncement({
    title: 'Test Broadcast',
    body: 'Testing categories',
    targetRole: 'all',
    category: AnnouncementCategory.EMERGENCY,
    priority: AnnouncementPriority.URGENT,
  });
  console.log('Created Entity:', JSON.stringify(created, null, 2));
  
  console.log('2. Fetching announcements...');
  const res = await service.getAnnouncements({ page: 1, limit: 1 });
  console.log('Fetched Entity:', JSON.stringify(res.announcements[0], null, 2));

  await app.close();
  process.exit(0);
}
bootstrap().catch(console.error);
