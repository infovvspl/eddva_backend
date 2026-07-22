import { Injectable, Logger } from '@nestjs/common';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { LogAiUsageDto } from './dto/log-ai-usage.dto';

@Injectable()
export class InternalAiUsageService {
  private readonly logger = new Logger(InternalAiUsageService.name);

  constructor(private readonly aiUsageService: AiUsageService) {}

  async logUsage(dto: LogAiUsageDto): Promise<{ logged: boolean }> {
    try {
      await this.aiUsageService.record({
        instituteId: dto.instituteId?.trim() || null,
        vertical: dto.instituteType?.trim() || null,
        feature: dto.featureId,
        provider: dto.modelUsed ?? null,
        model: dto.modelUsed ?? null,
        success: dto.success ?? true,
        latencyMs: dto.latencyMs ?? null,
        promptTokens: dto.tokensInput ?? null,
        completionTokens: dto.tokensOutput ?? null,
        totalTokens: ((dto.tokensInput ?? 0) + (dto.tokensOutput ?? 0)) || null,
        estCost: dto.estimatedCost ?? null,
        statusCode: null,
      });
      return { logged: true };
    } catch (err: unknown) {
      this.logger.error('Failed to persist AI usage log', err);
      return { logged: false };
    }
  }
}
