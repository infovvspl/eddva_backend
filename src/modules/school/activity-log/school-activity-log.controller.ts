import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

import { AuditLogService } from '../../audit-log/audit-log.service';

@Controller('school/admin/audit-logs')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolActivityLogController {
  constructor(
    private readonly svc: SchoolActivityLogService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get() 
  list(@SchoolUser() user: any, @Query() query: any) { 
    const isSuperAdmin = user.role?.toUpperCase() === 'SUPER_ADMIN';
    const instituteId = isSuperAdmin ? (query.instituteId || user.instituteId) : user.instituteId;
    return this.auditLogService.findAll({
      ...query,
      instituteId: instituteId || undefined,
    }, 'school');
  }

  @Post() createLog(@SchoolUser() user: any, @Body() body: any) { return this.svc.createLog(user, body); }
}
