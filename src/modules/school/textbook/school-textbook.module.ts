import { Module } from '@nestjs/common';
import { SchoolTextbookController } from './school-textbook.controller';
import { SchoolTextbookService } from './school-textbook.service';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { UploadModule } from '../../upload/upload.module';

@Module({
  imports: [AiBridgeModule, UploadModule],
  controllers: [SchoolTextbookController],
  providers: [SchoolTextbookService],
  // Exported so PPT generation can look up a chapter's passages before writing.
  exports: [SchoolTextbookService],
})
export class SchoolTextbookModule {}
