import { Module } from '@nestjs/common';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolClassService } from './school-class.service';
import { SchoolClassController } from './school-class.controller';
import { ThumbnailService } from './thumbnail.service';
import { TranscodeService } from './transcode.service';
import { CloudflareStreamService } from './stream.service';
import { R2Module } from '../../storage/r2.module';

@Module({
  imports: [UploadModule, AiBridgeModule, R2Module],
  controllers: [SchoolClassController],
  providers: [SchoolClassService, ThumbnailService, TranscodeService, CloudflareStreamService],
  exports: [SchoolClassService],
})
export class SchoolClassModule {}
