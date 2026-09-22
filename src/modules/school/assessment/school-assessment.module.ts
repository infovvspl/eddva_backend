import { Module } from '@nestjs/common';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAssessmentController } from './school-assessment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';
import { UploadModule } from '../../upload/upload.module';
import { SchoolDiagramService } from './diagram/school-diagram.service';
import { SchoolDiagramController } from './diagram/school-diagram.controller';

@Module({
  imports: [SchoolTextbookModule, SchoolNotificationModule, AiBridgeModule, SchoolNotificationFcmModule, UploadModule],
  controllers: [SchoolAssessmentController, SchoolDiagramController],
  providers: [SchoolAssessmentService, SchoolDiagramService]
})
export class SchoolAssessmentModule {}

