import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolStaffService } from './school-staff.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller('school/staff')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolStaffController {
  constructor(private readonly svc: SchoolStaffService) {}

  @Post()
  @SchoolRoles('INSTITUTE_ADMIN')
  @Audit({ module: 'Users', action: 'Staff Create', description: 'Created staff {body.name}' })
  create(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Get()
  @SchoolRoles('INSTITUTE_ADMIN')
  list(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.list(user, query);
  }
}
