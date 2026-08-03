import { Module } from '@nestjs/common';
import { SchoolMeetingController } from './school-meeting.controller';
import { SchoolMeetingService } from './school-meeting.service';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolMeetingController],
  providers: [SchoolMeetingService],
  exports: [SchoolMeetingService],
})
export class SchoolMeetingModule {}
