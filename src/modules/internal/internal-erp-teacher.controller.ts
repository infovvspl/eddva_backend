import { Body, Controller, Headers, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { InternalErpTeacherService } from './internal-erp-teacher.service';
import { ErpTeacherDto } from './dto/erp-teacher.dto';
import { ErpTeacherStatusDto } from './dto/erp-teacher-status.dto';

@Controller('internal/erp/teachers')
export class InternalErpTeacherController {
  constructor(private readonly service: InternalErpTeacherService) {}

  private assertInternal(key?: string): void {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    const a = Buffer.from(key ?? '');
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  @Post()
  async upsert(@Headers('x-internal-key') key: string, @Body() dto: ErpTeacherDto) {
    this.assertInternal(key);
    return this.service.upsert(dto);
  }

  @Patch('status')
  async updateStatus(@Headers('x-internal-key') key: string, @Body() dto: ErpTeacherStatusDto) {
    this.assertInternal(key);
    return this.service.updateStatus(dto);
  }
}
