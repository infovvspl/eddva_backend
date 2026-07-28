import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { SchoolCalendarService } from './school-calendar.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';
import { SchoolFeature } from '../decorators/school-feature.decorator';
import { SchoolFeatureGuard } from '../guards/school-feature.guard';

@Controller('school/calendar')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard, SchoolFeatureGuard)
@SchoolFeature('module', 'academic_calendar')
export class SchoolCalendarController {
  constructor(private readonly svc: SchoolCalendarService) {}

  @Get('events')
  getEvents(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getEvents(user, query);
  }

  @Get('featured-achievements')
  getFeaturedAchievements(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getFeaturedAchievements(user, query);
  }

  @Post('featured-achievements')
  saveFeaturedAchievement(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.saveFeaturedAchievement(user, body);
  }
}
