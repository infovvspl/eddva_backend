import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { InternalAiUsageService } from './internal-ai-usage.service';
import { LogAiUsageDto } from './dto/log-ai-usage.dto';

@Controller('internal/ai-usage')
export class InternalAiUsageController {
  constructor(private readonly service: InternalAiUsageService) {}

  @Post('log')
  async logUsage(
    @Headers('x-internal-key') internalKey: string,
    @Body() dto: LogAiUsageDto,
  ): Promise<{ logged: boolean }> {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    if (!expected || internalKey !== expected) {
      throw new UnauthorizedException('Invalid internal key');
    }
    return this.service.logUsage(dto);
  }
}
