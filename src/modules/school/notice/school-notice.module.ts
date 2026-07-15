import { Module } from '@nestjs/common';
import { SchoolNoticeService } from './school-notice.service';
import { SchoolNoticeController } from './school-notice.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolNoticeController],
  providers: [SchoolNoticeService],
})
export class SchoolNoticeModule {}

