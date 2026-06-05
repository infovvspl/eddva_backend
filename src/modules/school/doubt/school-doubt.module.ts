import { Module } from '@nestjs/common';
import { AIModule } from '../../../ai/ai.module';
import { UploadModule } from '../../upload/upload.module';
import { SchoolDoubtService } from './school-doubt.service';
import { SchoolDoubtController } from './school-doubt.controller';

@Module({
  imports: [AIModule, UploadModule],
  controllers: [SchoolDoubtController],
  providers: [SchoolDoubtService],
  exports: [SchoolDoubtService],
})
export class SchoolDoubtModule {}
