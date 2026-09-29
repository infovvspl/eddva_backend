import { Module } from '@nestjs/common';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { SchoolAiTutorController } from './school-ai-tutor.controller';
import { SchoolAiTutorService } from './school-ai-tutor.service';

@Module({
  imports: [AiBridgeModule, SchoolTextbookModule],
  controllers: [SchoolAiTutorController],
  providers: [SchoolAiTutorService],
})
export class SchoolAiTutorModule {}
