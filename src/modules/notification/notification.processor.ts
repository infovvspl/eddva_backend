import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { NOTIFICATION_QUEUE, NotificationJobs } from './notification.constants';
import { NotificationService } from './notification.service';

type ExternalJobData = {
  notificationId: string;
  userId: string;
  tenantId: string;
  title: string;
  body: string;
};

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Process(NotificationJobs.SEND_PUSH)
  async handlePush(job: Job<ExternalJobData>) {
    this.logger.debug(`Processing push job ${job.id} for user ${job.data.userId}`);
    await this.notificationService.deliverExternalNotification(
      job.data.notificationId,
      job.data.userId,
      'push',
      job.data.title,
      job.data.body,
    );
  }

  @Process(NotificationJobs.SEND_SMS)
  async handleSms(job: Job<ExternalJobData>) {
    this.logger.debug(`Processing SMS job ${job.id} for user ${job.data.userId}`);
    await this.notificationService.deliverExternalNotification(
      job.data.notificationId,
      job.data.userId,
      'sms',
      job.data.title,
      job.data.body,
    );
  }

  @Process(NotificationJobs.SEND_WHATSAPP)
  async handleWhatsApp(job: Job<ExternalJobData>) {
    this.logger.debug(`Processing WhatsApp job ${job.id} for user ${job.data.userId}`);
    await this.notificationService.deliverExternalNotification(
      job.data.notificationId,
      job.data.userId,
      'whatsapp',
      job.data.title,
      job.data.body,
    );
  }
}
