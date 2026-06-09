import { Module } from '@nestjs/common';
import { UploadModule } from '../../upload/upload.module';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolClassService } from './school-class.service';
import { SchoolClassController } from './school-class.controller';

@Module({
  imports: [UploadModule, AiBridgeModule],
  controllers: [SchoolClassController],
  providers: [SchoolClassService],
})
export class SchoolClassModule {}
