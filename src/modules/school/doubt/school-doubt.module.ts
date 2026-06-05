import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { UploadModule } from '../../upload/upload.module';
import { SchoolDoubtService } from './school-doubt.service';
import { SchoolDoubtController } from './school-doubt.controller';

@Module({
  imports: [AiBridgeModule, UploadModule],
  controllers: [SchoolDoubtController],
  providers: [SchoolDoubtService],
  exports: [SchoolDoubtService],
})
export class SchoolDoubtModule {}
