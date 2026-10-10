import { Module } from '@nestjs/common';
import { SchoolPptController } from './school-ppt.controller';
import { SchoolPptService } from './school-ppt.service';
import { PptJobsStore } from './ppt-jobs.store';
import { AiBridgeModule } from '../../ai-bridge/ai-bridge.module';
import { SchoolTextbookModule } from '../textbook/school-textbook.module';
import { InternalModule } from '../../internal/internal.module';

@Module({
  imports: [AiBridgeModule, SchoolTextbookModule, InternalModule],
  controllers: [SchoolPptController],
  providers: [SchoolPptService, PptJobsStore],
})
export class SchoolPptModule {}
