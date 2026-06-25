import { DataSource } from 'typeorm';
import { Student } from './src/database/entities/student.entity';
import { CoachingNotificationLog } from './src/database/entities/coaching-notification-log.entity';
import { Notification } from './src/database/entities/analytics.entity';
import { CoachingNotificationService } from './src/coaching/notification/notification.service';
import { User } from './src/database/entities/user.entity';
import { coachingDbConfig } from './src/config/database.config';

async function runTest() {
  require('dotenv').config({ path: __dirname + '/.env' });

  const dataSource = new DataSource({
    ...coachingDbConfig,
    name: 'default',
  } as any);

  await dataSource.initialize();
  
  const studentRepo = dataSource.getRepository(Student);
  const logRepo = dataSource.getRepository(CoachingNotificationLog);
  const notifRepo = dataSource.getRepository(Notification);

  const student = await studentRepo.createQueryBuilder('student')
    .innerJoin(User, 'user', 'user.id = student.userId')
    .where('user.email = :email', { email: 'bhagyasreesendh09@gmail.com' })
    .getOne();

  if (!student) {
    console.log('No student found with that email');
    process.exit(1);
  }

  console.log(`Found student: ${student.id}, userId: ${student.userId}`);

  const service = new CoachingNotificationService(logRepo, notifRepo);
  service.onModuleInit();

  const typeStr = 'GOOD_AFTERNOON' as any;
  
  console.log(`Calling sendNotification...`);
  await service.sendNotification(student, typeStr, { name: 'Bhagyasree' });
  console.log(`sendNotification finished.`);

  // Check notifications table
  const notificationRow = await dataSource.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [student.userId]);
  
  console.log('Inserted record in notifications table:');
  console.dir(notificationRow[0], { depth: null });

  await dataSource.destroy();
  process.exit(0);
}

runTest().catch(console.error);
