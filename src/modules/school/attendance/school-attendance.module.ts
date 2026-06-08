import { Module } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolAttendanceController } from './school-attendance.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolAttendanceController],
  providers: [SchoolAttendanceService]
})
export class SchoolAttendanceModule {}
