import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolMeetingService } from './school-meeting.service';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

@Controller('school/meetings')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('module', 'meetings')
export class SchoolMeetingController {
  constructor(private readonly svc: SchoolMeetingService) {}

  @Get()
  @SchoolRoles('PARENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  list(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.list(user, query);
  }

  @Get('options')
  @SchoolRoles('PARENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  getOptions(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getOptions(user, query);
  }

  @Post()
  @SchoolRoles('PARENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  create(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.create(user, body);
  }

  @Patch(':id/status')
  @SchoolRoles('PARENT', 'TEACHER', 'INSTITUTE_ADMIN', 'SUPER_ADMIN')
  updateStatus(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateStatus(user, id, body);
  }
}
