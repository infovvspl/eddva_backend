import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTimetableService } from './school-timetable.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/timetables')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolTimetableController {
  constructor(private readonly svc: SchoolTimetableService) {}

  @Get() listTimetables(@SchoolUser() user: any, @Query() query: any) { return this.svc.listTimetables(user, query); }
  @Post() createTimetable(@SchoolUser() user: any, @Body() body: any) { return this.svc.createTimetable(user, body); }
  @Get(':id') findOneTimetable(@Param('id') id: string) { return this.svc.findOneTimetable(id); }
  @Put(':id') updateTimetable(@Param('id') id: string, @Body() body: any) { return this.svc.updateTimetable(id, body); }
  @Delete(':id') removeTimetable(@Param('id') id: string) { return this.svc.removeTimetable(id); }
}
