import { BadRequestException, Controller, Get, Headers, Query } from '@nestjs/common';
import { assertInternalKey } from '../internal/internal-key';
import { AiUsageAdminService } from './ai-usage-admin.service';

const PERIODS = ['today', 'week', 'month'] as const;
type Period = (typeof PERIODS)[number];

/**
 * Read-only AI usage for the platform console (eddva_platform). It reuses the same figures the LMS super
 * admin sees, so the two never disagree; the platform calls it with the shared internal key.
 */
@Controller('internal/platform/ai-usage')
export class InternalPlatformAiUsageController {
  constructor(private readonly usage: AiUsageAdminService) {}

  @Get('summary')
  async summary(@Headers('x-internal-key') key: string, @Query('period') period: string = 'month') {
    assertInternalKey(key);
    if (!PERIODS.includes(period as Period)) throw new BadRequestException(`period must be one of ${PERIODS.join(', ')}`);
    const [dashboard, byInstitute] = await Promise.all([
      this.usage.getDashboard('all', period as Period),
      this.usage.getByInstitute('all', period as Period, 'cost'),
    ]);
    return { period, dashboard, byInstitute };
  }
}
