import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';

import { Student } from '../../database/entities/student.entity';
import { CoachingNotificationLog } from '../../database/entities/coaching-notification-log.entity';
import { CoachingNotificationType } from './notification.types';

@Injectable()
export class CoachingNotificationService implements OnModuleInit {
  private readonly logger = new Logger(CoachingNotificationService.name);

  constructor(
    @InjectRepository(CoachingNotificationLog)
    private readonly notificationLogRepo: Repository<CoachingNotificationLog>,
  ) {}

  onModuleInit() {
    if (!getApps().length) {
      const serviceAccountParams = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      };

      if (serviceAccountParams.projectId && serviceAccountParams.clientEmail && serviceAccountParams.privateKey) {
        initializeApp({
          credential: cert(serviceAccountParams),
        });
        this.logger.log('Firebase Admin initialized successfully.');
      } else {
        this.logger.warn('Firebase credentials not found in environment variables. Push notifications will fail.');
      }
    }
  }

  async sendNotification(
    student: Student,
    type: CoachingNotificationType,
    variables: Record<string, string>,
  ): Promise<void> {
    try {
      if (!student.notificationEnabled) {
        return;
      }

      const timezone = student.timezone || 'Asia/Kolkata';
      const localTime = DateTime.now().setZone(timezone);
      const hour = localTime.hour;

      if (!student.quietHoursOverride && (hour < 6 || hour >= 22)) {
        return;
      }

      const startOfDay = localTime.startOf('day').toJSDate();
      const endOfDay = localTime.endOf('day').toJSDate();

      const existingLog = await this.notificationLogRepo.findOne({
        where: {
          studentId: student.id,
          notificationType: type,
          sentAt: Between(startOfDay, endOfDay),
        },
      });

      if (existingLog) {
        return;
      }

      const lang = student.languagePreference || 'en';
      let i18nData: any;
      try {
        const filePath = path.join(__dirname, 'i18n', `${lang}.json`);
        i18nData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (e) {
        const defaultFilePath = path.join(__dirname, 'i18n', 'en.json');
        i18nData = JSON.parse(fs.readFileSync(defaultFilePath, 'utf-8'));
      }

      const template = i18nData[type];
      if (!template) {
        this.logger.error(`Template not found for notification type: ${type}`);
        return;
      }

      let title = template.title;
      let body = template.body;

      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{${key}}`;
        title = title.split(placeholder).join(value);
        body = body.split(placeholder).join(value);
      }

      let status = 'FAILED';
      let fcmMessageId = null;

      if (student.fcmToken && getApps().length) {
        try {
          const response = await getMessaging().send({
            token: student.fcmToken,
            notification: {
              title,
              body,
            },
          });
          status = 'SUCCESS';
          fcmMessageId = response;
        } catch (err) {
          this.logger.error(`Failed to send Firebase notification to student ${student.id}: ${err.message}`);
        }
      } else {
        this.logger.warn(`No FCM token for student ${student.id} or Firebase not initialized`);
      }

      const log = this.notificationLogRepo.create({
        studentId: student.id,
        notificationType: type,
        sentAt: new Date(),
        status,
        fcmMessageId,
      });

      await this.notificationLogRepo.save(log);
    } catch (error) {
      this.logger.error(`Error in sendNotification: ${error.message}`);
    }
  }
}
