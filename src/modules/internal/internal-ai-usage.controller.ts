import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { LogAiUsageDto } from './dto/log-ai-usage.dto';

@Controller('internal/ai-usage')
export class InternalAiUsageController {
  private readonly logger = new Logger('InternalAiUsage');

  constructor(private readonly service: InternalAiUsageService) {}

  @Post('log')
  async logUsage(
    @Headers('x-internal-key') internalKey: string,
    @Body() dto: LogAiUsageDto,
  ): Promise<{ logged: boolean }> {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    if (!expected || internalKey !== expected) {
      this.logger.warn(`[log] rejected — key mismatch (received="${internalKey?.slice(0,8)}..." expected="${expected?.slice(0,8)}...")`);
      throw new UnauthorizedException('Invalid internal key');
    }
    this.logger.log(`[log] received feature=${dto.featureId} institute=${dto.instituteId} vertical=${dto.instituteType} tokens=${dto.tokensInput}+${dto.tokensOutput}`);
    return this.service.logUsage(dto);
  }
}
