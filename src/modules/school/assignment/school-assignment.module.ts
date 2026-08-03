import { Module } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolAssignmentController } from './school-assignment.controller';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { SchoolNotificationFcmModule } from '../notification-fcm/school-notification-fcm.module';

@Module({
  imports: [UploadModule, AiBridgeModule, SchoolNotificationModule, SchoolNotificationFcmModule],
  controllers: [SchoolAssignmentController],
  providers: [SchoolAssignmentService],
})
export class SchoolAssignmentModule {}
