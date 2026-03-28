import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { NotificationService } from './notification.service';
import { NotificationListQueryDto, SendNotificationDto } from './dto/notification.dto';

@ApiTags('Notification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT)
  @ApiOperation({ summary: 'List notifications for the current user' })
  getNotifications(
    @Query() query: NotificationListQueryDto,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.notificationService.getNotifications(user.id, tenantId, query);
  }

  @Patch(':id/read')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT)
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiParam({ name: 'id', type: 'string' })
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    return this.notificationService.markAsRead(id, user.id, tenantId);
  }

  @Patch('read-all')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.notificationService.markAllAsRead(user.id, tenantId);
  }

  @Get('unread-count')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.PARENT)
  @ApiOperation({ summary: 'Get unread notification count' })
  getUnreadCount(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.notificationService.getUnreadCount(user.id, tenantId);
  }

  @Post('send')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Send manual blast notification' })
  sendManualNotification(@Body() dto: SendNotificationDto) {
    return this.notificationService.sendManualBlast(dto);
  }
}
