import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { UploadModule } from '../../upload/upload.module';
import { SchoolDoubtService } from './school-doubt.service';
import { SchoolDoubtController } from './school-doubt.controller';
import { InternalModule } from '../../internal/internal.module';

@Module({
  imports: [AiBridgeModule, UploadModule, InternalModule],
  controllers: [SchoolDoubtController],
  providers: [SchoolDoubtService],
  exports: [SchoolDoubtService],
})
export class SchoolDoubtModule {}
