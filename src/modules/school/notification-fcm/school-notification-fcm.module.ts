import { Module } from '@nestjs/common';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { FcmService } from './fcm.service';
import { SchoolNotificationScheduler } from './school-notification.scheduler';

@Module({
  imports: [SchoolNotificationModule],
  providers: [FcmService, SchoolNotificationScheduler],
  exports: [FcmService],
})
export class SchoolNotificationFcmModule {}
