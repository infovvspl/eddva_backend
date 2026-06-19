import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SchoolNotificationService } from './modules/school/notification/school-notification.service';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const ds = app.get(DataSource, { strict: false });
  // getting 'school' connection
  const schoolDs = Array.from(app.getModules()).find(m => m.name === 'TypeOrmCoreModule' && m.token === 'Connection_school')?.instance;

  console.log("=== Testing Notification Queries ===");
  try {
    // We'll mock a generic user ID. Let's just find any user.
    const users = await ds.query('SELECT id FROM users LIMIT 1');
    const user = { id: users[0]?.id || '123' };

    const svc = app.get(SchoolNotificationService);
    
    const categories = ['attendance', 'assignment', 'announcement', 'live_class', 'result'];
    
    for (const cat of categories) {
       console.log(`\nTesting Category: ${cat}`);
       const res = await svc.list(user, { category: cat, limit: 5 });
       console.log(`Total count: ${res.total}`);
       // print distinct types fetched
       const types = new Set(res.data.map((d: any) => d.type));
       console.log(`Unique Types returned: ${Array.from(types).join(', ')}`);
    }
    
  } catch (e) {
    console.error('Error during test:', e);
  }
  
  await app.close();
}
bootstrap();
