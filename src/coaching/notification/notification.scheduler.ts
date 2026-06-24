import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Student } from '../../database/entities/student.entity';
import { CoachingNotificationService } from './notification.service';
import { CoachingNotificationType } from './notification.types';

@Injectable()
export class CoachingNotificationScheduler {
  private readonly logger = new Logger(CoachingNotificationScheduler.name);

  constructor(
    private readonly notificationService: CoachingNotificationService,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodMorning() {
    this.logger.log('Running GOOD_MORNING cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true } });
    for (const student of students) {
      await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_MORNING, {
        name: 'Student',
      });
    }
  }

  @Cron('30 21 * * *', { timeZone: 'Asia/Kolkata' })
  async handleGoodNight() {
    this.logger.log('Running GOOD_NIGHT cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true } });
    for (const student of students) {
      await this.notificationService.sendNotification(student, CoachingNotificationType.GOOD_NIGHT, {
        name: 'Student',
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleClassReminder() {
    this.logger.log('Running CLASS_REMINDER cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true } });
    for (const student of students) {
      // TODO: Filter students based on actual class schedule (starts in 15 mins)
      // Passing placeholder variables for now
      /*
      await this.notificationService.sendNotification(student, CoachingNotificationType.CLASS_REMINDER, {
        subject: 'Math',
        batch: 'Batch A',
        time: '10:00 AM',
      });
      */
    }
  }

  @Cron('0 20 * * *', { timeZone: 'Asia/Kolkata' })
  async handleTestReminder() {
    this.logger.log('Running TEST_REMINDER cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true } });
    for (const student of students) {
      // TODO: Filter students based on actual test schedule (test tomorrow)
      /*
      await this.notificationService.sendNotification(student, CoachingNotificationType.TEST_REMINDER, {
        time: '9:00 AM',
      });
      */
    }
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async handleFeeDue() {
    this.logger.log('Running FEE_DUE cron');
    const students = await this.studentRepo.find({ where: { notificationEnabled: true } });
    for (const student of students) {
      // TODO: Filter students based on actual fee due in 3 days
      /*
      await this.notificationService.sendNotification(student, CoachingNotificationType.FEE_DUE, {
        amount: '1000',
        date: '2024-01-01',
      });
      */
    }
  }
}
