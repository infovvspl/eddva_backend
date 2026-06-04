import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTimetableService } from './school-timetable.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';

@Controller('school/schedules')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolScheduleController {
  constructor(private readonly svc: SchoolTimetableService) {}

  @Get() listSchedules(@Query() query: any) { return this.svc.listSchedules(query); }
  @Post() createSchedule(@Body() body: any) { return this.svc.createSchedule(body); }
  @Put(':id') updateSchedule(@Param('id') id: string, @Body() body: any) { return this.svc.updateSchedule(id, body); }
  @Delete(':id') removeSchedule(@Param('id') id: string) { return this.svc.removeSchedule(id); }
}
