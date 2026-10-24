import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolEventService } from './school-event.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

// Reads (list/findOne) stay open to any authenticated school role — students,
// teachers, and parents all need to see events in their own calendars.
// Writes (create/update/remove) had NO role restriction at all until now —
// any authenticated user, including a student, could create/edit/delete any
// school-wide calendar event. Only the admin calendar pages
// (/school/admin/calendar, /school/super-admin/calendar) render the
// create/edit/delete UI, so this locks writes down to match.
@Controller('school/events')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolEventController {
  constructor(private readonly svc: SchoolEventService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post()
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  create(@SchoolUser() user: any, @Body() body: any) { return this.svc.create(user, body); }

  @Put(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  @SchoolRoles('SUPER_ADMIN', 'INSTITUTE_ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
