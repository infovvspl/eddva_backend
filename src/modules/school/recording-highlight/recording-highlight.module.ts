import { Module } from '@nestjs/common';
import { RecordingHighlightController } from './recording-highlight.controller';
import { RecordingHighlightService } from './recording-highlight.service';
import { SchoolModule } from '../school.module'; // To get connection, but we just use TypeOrmModule or InjectDataSource

@Module({
  controllers: [RecordingHighlightController],
  providers: [RecordingHighlightService],
  exports: [RecordingHighlightService],
})
export class RecordingHighlightModule {}
