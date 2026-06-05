import { Module } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolAssignmentController } from './school-assignment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [SchoolNotificationModule, UploadModule, AiBridgeModule],
  controllers: [SchoolAssignmentController],
  providers: [SchoolAssignmentService],
})
export class SchoolAssignmentModule {}
