import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { InternalAiUsageController } from './internal-ai-usage.controller';
import { AiFeatureFlagService } from './ai-feature-flag.service';

@Module({
  imports: [AiUsageModule],
  controllers: [InternalAiUsageController],
  providers: [InternalAiUsageService, AiFeatureFlagService],
  exports: [AiFeatureFlagService, InternalAiUsageService],
})
export class InternalModule {}
