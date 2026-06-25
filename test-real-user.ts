import { DataSource, MoreThan } from 'typeorm';
import { Student } from './src/database/entities/student.entity';
import { CoachingNotificationLog } from './src/database/entities/coaching-notification-log.entity';
import { Notification } from './src/database/entities/analytics.entity';
import { CoachingNotificationService } from './src/coaching/notification/notification.service';
import { User } from './src/database/entities/user.entity';
import { StudyPlan, PlanItem, PlanItemStatus } from './src/database/entities/learning.entity';
import { coachingDbConfig } from './src/config/database.config';
import { CoachingNotificationType } from './src/coaching/notification/notification.types';

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
  const studyPlanRepo = dataSource.getRepository(StudyPlan);
  const planItemRepo = dataSource.getRepository(PlanItem);

  const student = await studentRepo.createQueryBuilder('student')
    .innerJoin('student.user', 'u')
    .where('u.email = :email', { email: 'bhagyasreesendh09@gmail.com' })
    .getOne();

  if (!student) {
    console.log('No student found with that email');
    process.exit(1);
  }

  console.log(`Found student: ${student.id}, userId: ${student.userId}`);

  const activePlan = await studyPlanRepo.findOne({
    where: { studentId: student.id, validUntil: MoreThan(new Date()) },
    order: { generatedAt: 'DESC' }
  });

  let taskCount = 0;
  if (activePlan) {
    const today = new Date().toISOString().split('T')[0];
    taskCount = await planItemRepo.count({
      where: { studyPlanId: activePlan.id, scheduledDate: today, status: PlanItemStatus.PENDING }
    });
  }
  
  console.log(`Found taskCount = ${taskCount}`);

  const service = new CoachingNotificationService(logRepo, notifRepo);
  service.onModuleInit();

  const typeStr = CoachingNotificationType.STUDY_PLAN_PENDING;
  
  if (taskCount > 0) {
    console.log(`Calling sendNotification...`);
    await service.sendNotification(student, typeStr, { 
      name: 'Bhagyasree', 
      taskCount: taskCount.toString() 
    });
    console.log(`sendNotification finished.`);

    // Check notifications table
    const notificationRow = await dataSource.query(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [student.userId]);
    
    console.log('Inserted record in notifications table:');
    console.dir(notificationRow[0], { depth: null });
  } else {
    console.log('Skipping notification, taskCount is 0');
  }

  await dataSource.destroy();
  process.exit(0);
}

runTest().catch(console.error);
