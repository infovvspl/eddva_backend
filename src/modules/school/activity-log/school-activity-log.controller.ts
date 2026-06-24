import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';

import { AuditLogService } from '../../audit-log/audit-log.service';

@Controller('school/admin/audit-logs')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolActivityLogController {
  constructor(
    private readonly svc: SchoolActivityLogService,
    private readonly auditLogService: AuditLogService,
  ) { }

  @Get('actors')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  async getActors(@SchoolUser() user: any, @Query('instituteId') queryInstituteId?: string) {
    const isSuperAdmin = user.role?.toUpperCase() === 'SUPER_ADMIN';
    let instituteId: string | undefined;

    if (isSuperAdmin) {
      instituteId = queryInstituteId || undefined;
    } else {
      if (!user.instituteId) {
        return [];
      }
      instituteId = user.instituteId;
    }

    return this.auditLogService.findUniqueActors(instituteId);
  }

  @Get()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  list(@SchoolUser() user: any, @Query() query: any) {
    const isSuperAdmin = user.role?.toUpperCase() === 'SUPER_ADMIN';
    let instituteId: string | undefined;

    if (isSuperAdmin) {
      instituteId = query.instituteId || undefined;
    } else {
      if (!user.instituteId) {
        return {
          data: [],
          meta: {
            total: 0,
            page: 1,
            limit: Number(query.limit) || 20,
            totalPages: 0,
          },
        };
      }
      instituteId = user.instituteId;
    }

    return this.auditLogService.findAll({
      ...query,
      instituteId: instituteId || undefined,
    }, 'school');
  }

  @Post()
  createLog(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createLog(user, body);
  }
}
