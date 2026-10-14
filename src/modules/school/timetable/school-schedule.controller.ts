import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolTimetableService } from './school-timetable.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';
import { AdminModuleGuard } from '../guards/admin-module.guard';
import { RequireAdminModule } from '../decorators/require-admin-module.decorator';

@Controller('school/schedules')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard, AdminModuleGuard)
@SchoolFeature('module', 'timetable')
@RequireAdminModule('timetable')
export class SchoolScheduleController {
  constructor(private readonly svc: SchoolTimetableService) {}

  @Get() listSchedules(@Query() query: any) { return this.svc.listSchedules(query); }
  @Post() createSchedule(@Body() body: any) { return this.svc.createSchedule(body); }
  @Put(':id') updateSchedule(@Param('id') id: string, @Body() body: any) { return this.svc.updateSchedule(id, body); }
  @Delete(':id') removeSchedule(@Param('id') id: string) { return this.svc.removeSchedule(id); }
}
