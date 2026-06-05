import { Module } from '@nestjs/common';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAssessmentController } from './school-assessment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolAssessmentController],
  providers: [SchoolAssessmentService]
})
export class SchoolAssessmentModule {}

