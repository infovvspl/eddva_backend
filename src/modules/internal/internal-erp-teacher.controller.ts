import { Body, Controller, Get, Headers, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { InternalErpTeacherService } from './internal-erp-teacher.service';
import { ErpTeacherDto } from './dto/erp-teacher.dto';
import { ErpTeacherStatusDto } from './dto/erp-teacher-status.dto';
import { ErpTeacherDepartmentDto } from './dto/erp-teacher-department.dto';

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

  @Get()
  async list(@Headers('x-internal-key') key: string, @Query('instituteId') instituteId: string) {
    this.assertInternal(key);
    return this.service.listForInstitute(instituteId);
  }

  /** Resolves a logged-in teacher's own LMS user id to their teacher/employee id, for the ERP's teacher self-service SSO exchange. */
  @Get('resolve')
  async resolve(
    @Headers('x-internal-key') key: string,
    @Query('instituteId') instituteId: string,
    @Query('userId') userId: string,
  ) {
    this.assertInternal(key);
    return this.service.resolveByUserId(instituteId, userId);
  }

  @Patch('status')
  async updateStatus(@Headers('x-internal-key') key: string, @Body() dto: ErpTeacherStatusDto) {
    this.assertInternal(key);
    return this.service.updateStatus(dto);
  }

  @Patch('department')
  async updateDepartment(@Headers('x-internal-key') key: string, @Body() dto: ErpTeacherDepartmentDto) {
    this.assertInternal(key);
    return this.service.updateDepartment(dto);
  }
}
