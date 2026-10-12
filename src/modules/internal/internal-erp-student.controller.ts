import { Body, Controller, Headers, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { InternalErpStudentService } from './internal-erp-student.service';
import { ErpStudentDto } from './dto/erp-student.dto';
import { ErpStudentStatusDto } from './dto/erp-student-status.dto';

@Controller('internal/erp/students')
export class InternalErpStudentController {
  constructor(private readonly service: InternalErpStudentService) {}

  private assertInternal(key?: string): void {
    const expected = process.env.INTERNAL_API_KEY ?? '';
    const a = Buffer.from(key ?? '');
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  @Post()
  async upsert(@Headers('x-internal-key') key: string, @Body() dto: ErpStudentDto) {
    this.assertInternal(key);
    return this.service.upsert(dto);
  }

  @Patch('status')
  async updateStatus(@Headers('x-internal-key') key: string, @Body() dto: ErpStudentStatusDto) {
    this.assertInternal(key);
    return this.service.updateStatus(dto);
  }
}
