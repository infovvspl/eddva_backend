import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SchoolNotificationScheduler } from '../src/modules/school/notification-fcm/school-notification.scheduler';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const scheduler = app.get(SchoolNotificationScheduler);

  try {
    // Get the school database connection using TypeORM token helper or fallback to default DataSource
    let schoolDs: DataSource;
    try {
      schoolDs = app.get<DataSource>(getDataSourceToken('school'));
    } catch {
      schoolDs = app.get<DataSource>(DataSource);
    }
    
    // Check user & student status
    const userId = 'b49ee8d3-4c33-448c-aa06-30dc8bfbee54';
    const userRow = await schoolDs.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    console.log('USER ROW:', userRow[0]);

    if (userRow[0]) {
      const studentRow = await schoolDs.query(`SELECT * FROM students WHERE user_id = $1`, [userId]);
      console.log('STUDENT ROW BEFORE:', studentRow[0]);

      if (studentRow[0]) {
        if (!studentRow[0].notification_enabled) {
          console.log('Enabling notifications for student...');
          await schoolDs.query(`UPDATE students SET notification_enabled = true WHERE user_id = $1`, [userId]);
        }
      } else {
        console.log('User is not a student (or student profile missing).');
      }
    }

    console.log('\n--- Running handleGoodMorning() ---');
    await scheduler.handleGoodMorning();
    console.log('handleGoodMorning() completed.');

    // Print logs
    const logs = await schoolDs.query(`SELECT * FROM school_notification_log ORDER BY sent_at DESC LIMIT 5`);
    console.log('\n=== LATEST NOTIFICATION LOGS ===');
    console.log(logs);

  } catch (err) {
    console.error('Error running trigger:', err);
  } finally {
    await app.close();
    process.exit(0);
  }
}

run();
