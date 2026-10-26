import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { InternalErpModulesService } from './internal-erp-modules.service';

@Controller('internal/erp/modules')
export class InternalErpModulesController {
  constructor(private readonly service: InternalErpModulesService) {}

  private assertInternal(key?: string): void {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    const a = Buffer.from(key ?? '');
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  /** The ERP backend calls this to find out which modules (by path) an institute currently has enabled. */
  @Get()
  async getEnabled(@Headers('x-internal-key') key: string, @Query('instituteId') instituteId: string) {
    this.assertInternal(key);
    const paths = await this.service.getEnabledModulePaths(instituteId);
    return { data: paths };
  }
}
