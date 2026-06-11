import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/calendar/events')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolCalendarController {
  constructor(private readonly svc: SchoolCalendarService) {}

  @Get()
  getEvents(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getEvents(user, query);
  }
}
