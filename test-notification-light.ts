import { DataSource } from 'typeorm';
import { Student } from './src/database/entities/student.entity';
import { CoachingNotificationLog } from './src/database/entities/coaching-notification-log.entity';
import { Notification } from './src/database/entities/analytics.entity';
import { CoachingNotificationService } from './src/coaching/notification/notification.service';
import { coachingDbConfig } from './src/config/database.config';

// We need to initialize the DataSource manually to avoid NestJS hangs
async function runTest() {
  require('dotenv').config({ path: __dirname + '/.env' });

  const dataSource = new DataSource({
    ...coachingDbConfig,
    name: 'default',
  } as any);

  await dataSource.initialize();
  console.log('Database connected.');

  const studentRepo = dataSource.getRepository(Student);
  const logRepo = dataSource.getRepository(CoachingNotificationLog);
  const notifRepo = dataSource.getRepository(Notification);

  const student = await studentRepo.findOne({
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

  const service = new CoachingNotificationService(logRepo, notifRepo);
  // Need to call onModuleInit to init firebase, but we can just skip it or let it fail gracefully
  service.onModuleInit();

  const typeStr = 'GOOD_MORNING' as any;
  
  console.log(`Calling sendNotification...`);
  await service.sendNotification(student, typeStr, { name: 'Test User' });
  console.log(`sendNotification finished.`);

  // Check notifications table
  const notificationRow = await dataSource.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [student.userId]);
  
  console.log('Inserted record in notifications table:');
  console.dir(notificationRow[0], { depth: null });

  // Clean up
  if (notificationRow && notificationRow.length > 0) {
    console.log(`Cleaning up test record id: ${notificationRow[0].id}`);
    await dataSource.query(`DELETE FROM notifications WHERE id = $1`, [notificationRow[0].id]);
    await dataSource.query(`DELETE FROM coaching_notification_log WHERE student_id = $1 AND notification_type = $2`, [student.id, typeStr]);
    console.log(`Clean up complete.`);
  }

  await dataSource.destroy();
  process.exit(0);
}

runTest().catch(console.error);
