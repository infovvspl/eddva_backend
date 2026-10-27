import { Controller, Get, Headers } from '@nestjs/common';
import { SchoolInstituteService } from '../school/institute/school-institute.service';
import { assertInternalKey } from './internal-key';

/** Real stored-file totals (documents, presentations, lecture videos) for the platform console. */
@Controller('internal/platform/storage')
export class InternalPlatformStorageController {
  constructor(private readonly institutes: SchoolInstituteService) {}

  @Get()
  async totals(@Headers('x-internal-key') key: string) {
    assertInternalKey(key);
    const usage = await this.institutes.storageUsage();
    return { totalBytes: Number(usage.platformTotalKb) * 1024, institutes: usage.institutes.length };
  }
}
