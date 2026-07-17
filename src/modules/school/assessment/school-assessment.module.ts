import { Module } from '@nestjs/common';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAssessmentController } from './school-assessment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [SchoolNotificationModule, AiBridgeModule, SchoolNotificationFcmModule],
  controllers: [SchoolAssessmentController],
  providers: [SchoolAssessmentService]
})
export class SchoolAssessmentModule {}

