import { Injectable, Logger } from '@nestjs/common';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { LogAiUsageDto } from './dto/log-ai-usage.dto';
import { LogProviderEventDto } from './dto/log-provider-event.dto';

@Injectable()
export class InternalAiUsageService {
  private readonly logger = new Logger(InternalAiUsageService.name);

  constructor(private readonly aiUsageService: AiUsageService) {}

  /**
   * The AI service reports only the model it used, so `provider` was being filled
   * with the model id. Once routing began returning ids like
   * "together:zai-org/GLM-5.3-Flash" (30 chars) that overflowed provider's
   * VARCHAR(24) and EVERY routed call failed to record — generation succeeded but
   * the usage row was silently lost.
   *
   * Routed ids carry their provider as a "<provider>:" prefix. Unprefixed ids are
   * the historical Groq/Gemini ones, mapped by their well-known shapes; anything
   * unrecognised stays null rather than guessing, so a wrong provider never gets
   * attributed a cost.
   */
  static providerOf(modelUsed?: string | null): string | null {
    const id = (modelUsed || '').trim();
    if (!id) return null;
    const colon = id.indexOf(':');
    if (colon > 0) return id.slice(0, colon);
    const low = id.toLowerCase();
    if (low.startsWith('gemini')) return 'gemini';
    if (low.startsWith('openai/') || low.startsWith('qwen/') || low.startsWith('llama')) return 'groq';
    if (low === 'scientific_solver') return 'groq';
    return null;
  }

  async logUsage(dto: LogAiUsageDto): Promise<{ logged: boolean }> {
    try {
      await this.aiUsageService.record({
        instituteId: dto.instituteId?.trim() || null,
        vertical: dto.instituteType?.trim() || null,
        feature: dto.featureId,
        provider: InternalAiUsageService.providerOf(dto.modelUsed),
        model: dto.modelUsed ?? null,
        success: dto.success ?? true,
        latencyMs: dto.latencyMs ?? null,
        promptTokens: dto.tokensInput ?? null,
        completionTokens: dto.tokensOutput ?? null,
        totalTokens: ((dto.tokensInput ?? 0) + (dto.tokensOutput ?? 0)) || null,
        estCost: dto.estimatedCost ?? null,
        statusCode: null,
        // P1-6: forward attribution the AI service already sends but which was
        // previously dropped here, so cost-per-user/role/request becomes queryable.
        userId: dto.userId?.trim() || null,
        userRole: dto.userRole?.trim() || null,
        requestId: dto.requestId?.trim() || null,
      });
      return { logged: true };
    } catch (err: unknown) {
      this.logger.error('Failed to persist AI usage log', err);
      return { logged: false };
    }
  }

  async logProviderEvent(dto: LogProviderEventDto): Promise<{ logged: boolean }> {
    try {
      await this.aiUsageService.recordProviderEvent({
        requestId: dto.requestId?.trim() || null,
        instituteId: dto.instituteId?.trim() || null,
        feature: dto.feature ?? null,
        provider: dto.provider ?? null,
        model: dto.model ?? null,
        eventType: dto.eventType,
        statusCode: dto.statusCode ?? null,
        retryAfterMs: dto.retryAfterMs ?? null,
        attemptNumber: dto.attemptNumber ?? null,
        keyHash: dto.keyHash ?? null,
      });
      return { logged: true };
    } catch (err: unknown) {
      this.logger.error('Failed to persist AI provider event', err);
      return { logged: false };
    }
  }
}
