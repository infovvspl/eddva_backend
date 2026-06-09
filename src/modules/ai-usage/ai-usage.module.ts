import { Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';

/**
 * AI usage tracking + quota enforcement (per institute, per feature).
 * Exports AiUsageService so AiBridgeService can record every AI call.
 * The coaching-side controller (/ai-usage/*) lives here; the school-side
 * controller (/school/ai-usage/*) lives in SchoolAiUsageModule.
 */
@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
