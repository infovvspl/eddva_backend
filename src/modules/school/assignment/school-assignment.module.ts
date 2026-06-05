import { Module } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolAssignmentController } from './school-assignment.controller';
import { SchoolNotificationModule } from '../notification/school-notification.module';

@Module({
  imports: [SchoolNotificationModule],
  controllers: [SchoolAssignmentController],
  providers: [SchoolAssignmentService]
import { UploadModule } from '../../upload/upload.module';
  import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
    imports: [UploadModule, AiBridgeModule],
    controllers: [SchoolAssignmentController],
    providers: [SchoolAssignmentService],
  })
  export class SchoolAssignmentModule { }

