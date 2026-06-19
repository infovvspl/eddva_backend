import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SchoolNotificationService } from './modules/school/notification/school-notification.service';
import { getDataSourceToken } from '@nestjs/typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const dsToken = getDataSourceToken('school');
    const ds = app.get(dsToken);

    // Find a teacher
    const users = await ds.query("SELECT id FROM users WHERE role = 'TEACHER' LIMIT 1");
    if (!users.length) {
      console.log("No teacher found.");
      return;
    }
    const user = users[0];
    console.log("Testing with teacher user ID:", user.id);

    const svc = app.get(SchoolNotificationService);
    
    // Simulate frontend API request:
    console.log("=== GET /notifications?category=attendance ===");
    try {
      const res1 = await svc.list(user, { category: 'attendance', limit: 20 });
      console.log(`Success: true`);
      console.log(`Total: ${res1.total}, Data Length: ${res1.data.length}`);
      console.log(`Contains attendance_warning? ${res1.data.some((d: any) => d.type === 'attendance_warning')}`);
    } catch(err: any) {
      console.error("API 1 Error:", err.message);
    }

    console.log("\n=== GET /notifications?category=assignment ===");
    try {
      const res2 = await svc.list(user, { category: 'assignment', limit: 20 });
      console.log(`Success: true`);
      console.log(`Total: ${res2.total}, Data Length: ${res2.data.length}`);
      console.log(`Contains submission? ${res2.data.some((d: any) => d.type === 'submission')}`);
    } catch(err: any) {
      console.error("API 2 Error:", err.message);
    }
    
  } catch (e) {
    console.error('Error during test:', e);
  } finally {
    await app.close();
  }
}
bootstrap();
