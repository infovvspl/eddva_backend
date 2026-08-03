import { Module } from '@nestjs/common';
import { SchoolGrievanceService } from './school-grievance.service';
import { SchoolGrievanceController } from './school-grievance.controller';

import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolGrievanceController],
  providers: [SchoolGrievanceService]
})
export class SchoolGrievanceModule {}
