import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolParentService } from './school-parent.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolRoles } from '../decorators/school-roles.decorator';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/parent')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
@SchoolRoles('PARENT')
export class SchoolParentController {
  constructor(private readonly svc: SchoolParentService) {}

  @Get('profile') getProfile(@SchoolUser() user: any) {
    return this.svc.getProfile(user);
  }

  @Put('profile')
  updateProfile(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.updateProfile(user, body);
  }

  @Get('students') getChildren(@SchoolUser() user: any) {
    return this.svc.getChildren(user);
  }

  @Get('students/:id/summary') getSummary(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getStudentSummary(user, id);
  }

  @Get('students/:id/attendance')
  getAttendance(@SchoolUser() user: any, @Param('id') id: string, @Query('month') month?: string) {
    return this.svc.getAttendance(user, id, month);
  }

  @Post('students/:id/leave-request')
  submitLeaveRequest(@SchoolUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.submitLeaveRequest(user, id, body);
  }

  @Get('students/:id/marks') getMarks(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getMarks(user, id);
  }

  @Get('students/:id/homework') getHomework(@SchoolUser() user: any, @Param('id') id: string, @Query('filter') filter?: string) {
    return this.svc.getHomework(user, id, filter);
  }

  @Get('students/:id/tests') getTests(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.getTests(user, id);
  }

  @Get('teachers') getTeachers(@SchoolUser() user: any) {
    return this.svc.getTeachers(user);
  }

  @Get('chat/:teacherId') getChat(@SchoolUser() user: any, @Param('teacherId') teacherId: string) {
    return this.svc.getChatMessages(user, teacherId);
  }

  @Post('chat/:teacherId')
  sendMessage(@SchoolUser() user: any, @Param('teacherId') teacherId: string, @Body() body: any) {
    return this.svc.sendMessage(user, teacherId, body?.message);
  }

  @Get('meeting-requests') getMeetingRequests(@SchoolUser() user: any) {
    return this.svc.getMeetingRequests(user);
  }

  @Post('meeting-requests') createMeetingRequest(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.createMeetingRequest(user, body);
  }

  @Delete('meeting-requests/:id')
  cancelMeetingRequest(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.cancelMeetingRequest(user, id);
  }

  @Get('grievances') getGrievances(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.getGrievances(user, query);
  }

  @Post('grievances') submitGrievance(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.submitGrievance(user, body);
  }

  @Put('grievances/:id/reopen')
  reopenGrievance(@SchoolUser() user: any, @Param('id') id: string) {
    return this.svc.reopenGrievance(user, id);
  }

  @Get('notifications') getNotifications(@SchoolUser() user: any) {
    return this.svc.getNotifications(user);
  }

  @Put('notifications/read') markRead(@SchoolUser() user: any) {
    return this.svc.markNotificationsRead(user);
  }
}
