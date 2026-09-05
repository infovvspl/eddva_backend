import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolClassService } from './school-class.service';
import { SchoolClassController } from './school-class.controller';
import { ThumbnailService } from './thumbnail.service';
import { TranscodeService } from './transcode.service';
import { CloudflareStreamService } from './stream.service';
import { R2Module } from '../../storage/r2.module';
import { LECTURE_QUEUE } from './lecture-queue.constants';
import { LectureProcessor } from './lecture.processor';

@Module({
  imports: [
    UploadModule,
    AiBridgeModule,
    R2Module,
    // Dedicated durable queue for lecture processing (P0-2), isolated from the
    // real-time AI path and from RECORDINGS_QUEUE. Uses the global Bull Redis
    // connection configured in app.module.
    BullModule.registerQueue({ name: LECTURE_QUEUE }),
  ],
  controllers: [SchoolClassController],
  providers: [SchoolClassService, ThumbnailService, TranscodeService, CloudflareStreamService, LectureProcessor],
  exports: [SchoolClassService],
})
export class SchoolClassModule {}
