import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { LogAiUsageDto } from './dto/log-ai-usage.dto';
import { LogProviderEventDto } from './dto/log-provider-event.dto';

@Controller('internal/ai-usage')
export class InternalAiUsageController {
  private readonly logger = new Logger('InternalAiUsage');

  constructor(private readonly service: InternalAiUsageService) {}

  /** Constant-time-ish shared-secret check for internal-only endpoints. */
  private assertInternal(internalKey: string): void {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    if (!expected || internalKey !== expected) {
      this.logger.warn(`rejected — key mismatch (received="${internalKey?.slice(0, 8)}..." expected="${expected?.slice(0, 8)}...")`);
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  @Post('log')
  async logUsage(
    @Headers('x-internal-key') internalKey: string,
    @Body() dto: LogAiUsageDto,
  ): Promise<{ logged: boolean }> {
    this.assertInternal(internalKey);
    this.logger.log(`[log] received feature=${dto.featureId} institute=${dto.instituteId} vertical=${dto.instituteType} tokens=${dto.tokensInput}+${dto.tokensOutput} user=${dto.userId ?? '-'} role=${dto.userRole ?? '-'}`);
    return this.service.logUsage(dto);
  }

  @Post('provider-event')
  async logProviderEvent(
    @Headers('x-internal-key') internalKey: string,
    @Body() dto: LogProviderEventDto,
  ): Promise<{ logged: boolean }> {
    this.assertInternal(internalKey);
    this.logger.log(`[provider-event] type=${dto.eventType} provider=${dto.provider ?? '-'} model=${dto.model ?? '-'} status=${dto.statusCode ?? '-'} attempt=${dto.attemptNumber ?? '-'}`);
    return this.service.logProviderEvent(dto);
  }
}
