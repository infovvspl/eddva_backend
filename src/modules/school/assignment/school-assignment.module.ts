import { Module } from '@nestjs/common';
import { SchoolAssignmentService } from './school-assignment.service';
import { SchoolAssignmentController } from './school-assignment.controller';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';

@Module({
  imports: [UploadModule, AiBridgeModule],
  controllers: [SchoolAssignmentController],
  providers: [SchoolAssignmentService],
})
export class SchoolAssignmentModule {}
