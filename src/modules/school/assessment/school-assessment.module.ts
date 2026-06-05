import { Module } from '@nestjs/common';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAssessmentController } from './school-assessment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [SchoolNotificationModule, AiBridgeModule],
  controllers: [SchoolAssessmentController],
  providers: [SchoolAssessmentService]
})
export class SchoolAssessmentModule {}

