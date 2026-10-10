import { Module } from '@nestjs/common';
import { SchoolTopicService } from './school-topic.service';
import { SchoolTopicController } from './school-topic.controller';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [AiBridgeModule, UploadModule],
  controllers: [SchoolTopicController],
  providers: [SchoolTopicService],
})
export class SchoolTopicModule {}
