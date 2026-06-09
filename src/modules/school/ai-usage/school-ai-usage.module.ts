import { Module } from '@nestjs/common';
import { AiUsageModule } from '../../ai-usage/ai-usage.module';
import { SchoolAiUsageController } from './school-ai-usage.controller';

@Module({
  imports: [AiUsageModule],
  controllers: [SchoolAiUsageController],
})
export class SchoolAiUsageModule {}
