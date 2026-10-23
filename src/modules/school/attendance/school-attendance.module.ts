import { Module } from '@nestjs/common';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolAttendanceController } from './school-attendance.controller';
import { SchoolTeacherAttendanceService } from './school-teacher-attendance.service';
import { SchoolTeacherAttendanceController } from './school-teacher-attendance.controller';
import { SchoolBiometricWebhookController } from './school-biometric-webhook.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolAttendanceController, SchoolTeacherAttendanceController, SchoolBiometricWebhookController],
  providers: [SchoolAttendanceService, SchoolTeacherAttendanceService]
})
export class SchoolAttendanceModule {}
