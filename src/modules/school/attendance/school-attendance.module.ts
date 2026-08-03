import { Module } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolAttendanceController } from './school-attendance.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolAttendanceController],
  providers: [SchoolAttendanceService]
})
export class SchoolAttendanceModule {}
