import { Module } from '@nestjs/common';
import { SchoolMeetingController } from './school-meeting.controller';
import { SchoolMeetingService } from './school-meeting.service';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolMeetingController],
  providers: [SchoolMeetingService],
  exports: [SchoolMeetingService],
})
export class SchoolMeetingModule {}
