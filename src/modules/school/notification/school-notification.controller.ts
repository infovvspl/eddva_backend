import { Body, Controller, Delete, Get, Param, Post, Put, Patch, Query, UseGuards } from '@nestjs/common';
import { SchoolNotificationService } from './school-notification.service';
import { SchoolJwtGuard } from '../guards/school-jwt.guard';
import { SchoolRolesGuard } from '../guards/school-roles.guard';
import { SchoolUser } from '../decorators/school-user.decorator';

@Controller('school/notifications')
@UseGuards(SchoolJwtGuard, SchoolRolesGuard)
export class SchoolNotificationController {
  constructor(private readonly svc: SchoolNotificationService) {}

  @Get()
  list(@SchoolUser() user: any, @Query() query: any) {
    return this.svc.list(user, query);
  }

  @Get('unread-count')
  getUnreadCount(@SchoolUser() user: any) {
    return this.svc.getUnreadCount(user);
  }

  @Post()
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Put('read-all')
  markAllAsReadPut(@SchoolUser() user: any) {
    return this.svc.markAllAsRead(user);
  }

  @Patch('read-all')
  markAllAsReadPatch(@SchoolUser() user: any) {
    return this.svc.markAllAsRead(user);
  }

  @Patch('bulk-read')
  bulkRead(@SchoolUser() user: any, @Body('ids') ids: string[]) {
    return this.svc.bulkRead(user, ids);
  }

  @Delete('bulk-delete')
  bulkDelete(@SchoolUser() user: any, @Body('ids') ids: string[]) {
    return this.svc.bulkDelete(user, ids);
  }

  @Get('preferences')
  getPreferences(@SchoolUser() user: any) {
    return this.svc.getPreferences(user);
  }

  @Put('preferences')
  updatePreferences(@SchoolUser() user: any, @Body() body: any) {
    return this.svc.updatePreferences(user, body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Put(':id/read')
  markReadPut(@Param('id') id: string) {
    return this.svc.markRead(id);
  }

  @Patch(':id/read')
  markReadPatch(@Param('id') id: string) {
    return this.svc.markRead(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
