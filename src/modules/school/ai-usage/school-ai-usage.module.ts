import { Module } from '@nestjs/common';
import { AiUsageModule } from '../../ai-usage/ai-usage.module';
import { SchoolAiUsageController } from './school-ai-usage.controller';
import { SchoolSuperAdminAiUsageController } from './school-super-admin-ai-usage.controller';

@Module({
  imports: [AiUsageModule],
  controllers: [SchoolAiUsageController, SchoolSuperAdminAiUsageController],
})
export class SchoolAiUsageModule {}
