import { Module } from '@nestjs/common';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolSyllabusModule } from '../syllabus/school-syllabus.module';
import { FcmService } from './fcm.service';
import { SchoolNotificationScheduler } from './school-notification.scheduler';

@Module({
  imports: [SchoolNotificationModule, SchoolSyllabusModule],
  providers: [FcmService, SchoolNotificationScheduler],
  exports: [FcmService],
})
export class SchoolNotificationFcmModule {}
