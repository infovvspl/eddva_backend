import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTimetableService } from './school-timetable.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { Audit } from '../../audit-log/audit.decorator';

@Controller(['school/timetables', 'school/timetable'])
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTimetableController {
  constructor(private readonly svc: SchoolTimetableService) {}

  @Get() listTimetables(@SchoolUser() user: any, @Query() query: any) { return this.svc.listTimetables(user, query); }
  @Get('student/me') getStudentTimetable(@SchoolUser() user: any) { return this.svc.getStudentTimetable(user); }

  @Post()
  @Audit({ module: 'Academic', action: 'Timetable Create', description: 'Created timetable entry' })
  createTimetable(@SchoolUser() user: any, @Body() body: any) { return this.svc.createTimetable(user, body); }

  @Put('bulk/update')
  @Audit({ module: 'Academic', action: 'Timetable Edit', description: 'Bulk updated timetable entries' })
  bulkUpdate(@SchoolUser() user: any, @Body() body: any) { return this.svc.bulkUpdate(user, body); }

  @Get(':id') findOneTimetable(@Param('id') id: string) { return this.svc.findOneTimetable(id); }

  @Put(':id')
  @Audit({ module: 'Academic', action: 'Timetable Edit', description: 'Updated timetable entry ID {params.id}' })
  updateTimetable(@Param('id') id: string, @Body() body: any) { return this.svc.updateTimetable(id, body); }

  @Delete(':id')
  @Audit({ module: 'Academic', action: 'Timetable Delete', description: 'Deleted timetable entry ID {params.id}' })
  removeTimetable(@Param('id') id: string) { return this.svc.removeTimetable(id); }
}
