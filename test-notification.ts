import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { CoachingNotificationService } from './src/coaching/notification/notification.service';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Student } from './src/database/entities/student.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const dataSource = app.get<DataSource>(getDataSourceToken('coaching'));
  const notificationService = app.get(CoachingNotificationService);

  // Find a student with a valid userId
  const student = await dataSource.getRepository(Student).findOne({
    where: {
      userId: require('typeorm').Not(require('typeorm').IsNull()),
    },
    order: {
      createdAt: 'DESC',
    }
  });

  if (!student) {
    console.log('No student with user_id found');
    process.exit(1);
  }

  console.log(`Found student: ${student.id}, userId: ${student.userId}`);

  const typeStr = 'GOOD_MORNING' as any; // Cast as any because type is CoachingNotificationType
  
  console.log(`Calling sendNotification...`);
  await notificationService.sendNotification(student, typeStr, { fullName: 'Test User' });
  console.log(`sendNotification finished.`);

  // Check notifications table
  const notificationRow = await dataSource.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [student.userId]);
  
  console.log('Inserted record in notifications table:');
  console.dir(notificationRow[0], { depth: null });

  // Clean up test record
  if (notificationRow && notificationRow.length > 0) {
    console.log(`Cleaning up test record id: ${notificationRow[0].id}`);
    await dataSource.query(`DELETE FROM notifications WHERE id = $1`, [notificationRow[0].id]);
    await dataSource.query(`DELETE FROM coaching_notification_log WHERE student_id = $1 AND notification_type = $2`, [student.id, typeStr]);
    console.log(`Clean up complete.`);
  }

  await app.close();
  process.exit(0);
}

bootstrap();
