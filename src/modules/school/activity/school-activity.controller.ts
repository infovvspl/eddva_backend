import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SchoolActivityService } from './school-activity.service';
import { AppHeartbeatDto } from './school-activity.dto';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/activity')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolActivityController {
  constructor(private readonly svc: SchoolActivityService) {}

  // No @SchoolRoles here — every authenticated school user reports their own
  // page-category activity, same reasoning as the generic screen-time
  // heartbeat (school-screen-time.controller.ts): who may VIEW the
  // consolidated report is a separate, more restricted concern.
  @Post('heartbeat')
  heartbeat(@SchoolUser() user: any, @Body() dto: AppHeartbeatDto) {
    return this.svc.recordHeartbeat(user, dto);
  }

  @Get('me')
  getMyBreakdown(@SchoolUser() user: any) {
    return this.svc.getMyBreakdown(user);
  }
}
