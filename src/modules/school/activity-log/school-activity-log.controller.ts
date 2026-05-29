import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolActivityLogService } from './school-activity-log.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/activity-logs')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolActivityLogController {
  constructor(private readonly svc: SchoolActivityLogService) {}

  @Get() list(@SchoolUser() user: any, @Query() query: any) { return this.svc.list(user, query); }
  @Post() createLog(@SchoolUser() user: any, @Body() body: any) { return this.svc.createLog(user, body); }
}
