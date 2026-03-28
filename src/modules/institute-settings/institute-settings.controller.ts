import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { InstituteSettingsService } from './institute-settings.service';
import {
  UpdateBrandingDto,
  UpdateBillingEmailDto,
  UpdateNotificationPrefsDto,
  CreateCalendarEventDto,
} from './dto/institute-settings.dto';

@ApiTags('Institute Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.INSTITUTE_ADMIN)
@Controller('institute/settings')
export class InstituteSettingsController {
  constructor(private readonly svc: InstituteSettingsService) {}

  // ── Branding ────────────────────────────────────────────────────────────────

  @Get('branding')
  @ApiOperation({ summary: 'Get institute branding' })
  getBranding(@TenantId() tenantId: string) {
    return this.svc.getBranding(tenantId);
  }

  @Patch('branding')
  @ApiOperation({ summary: 'Update institute branding (logo, color, welcome message)' })
  updateBranding(@TenantId() tenantId: string, @Body() dto: UpdateBrandingDto) {
    return this.svc.updateBranding(tenantId, dto);
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  @Get('subscription')
  @ApiOperation({ summary: 'Get subscription plan, usage, limits' })
  getSubscription(@TenantId() tenantId: string) {
    return this.svc.getSubscription(tenantId);
  }

  @Patch('billing-email')
  @ApiOperation({ summary: 'Update billing email' })
  updateBillingEmail(@TenantId() tenantId: string, @Body() dto: UpdateBillingEmailDto) {
    return this.svc.updateBillingEmail(tenantId, dto);
  }

  // ── Notification Preferences ─────────────────────────────────────────────────

  @Get('notifications')
  @ApiOperation({ summary: 'Get institute notification preferences' })
  getNotificationPrefs(@TenantId() tenantId: string) {
    return this.svc.getNotificationPrefs(tenantId);
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Update notification preferences' })
  updateNotificationPrefs(@TenantId() tenantId: string, @Body() dto: UpdateNotificationPrefsDto) {
    return this.svc.updateNotificationPrefs(tenantId, dto);
  }

  // ── Academic Calendar ─────────────────────────────────────────────────────────

  @Get('calendar')
  @ApiOperation({ summary: 'Get calendar events' })
  @ApiQuery({ name: 'year',  required: false })
  @ApiQuery({ name: 'month', required: false })
  getCalendar(
    @TenantId() tenantId: string,
    @Query('year')  year?: string,
    @Query('month') month?: string,
  ) {
    return this.svc.getCalendarEvents(tenantId, year ? +year : undefined, month ? +month : undefined);
  }

  @Post('calendar')
  @ApiOperation({ summary: 'Create a calendar event' })
  createCalendarEvent(@TenantId() tenantId: string, @Body() dto: CreateCalendarEventDto) {
    return this.svc.createCalendarEvent(tenantId, dto);
  }

  @Delete('calendar/:eventId')
  @ApiOperation({ summary: 'Delete a calendar event' })
  deleteCalendarEvent(@TenantId() tenantId: string, @Param('eventId') eventId: string) {
    return this.svc.deleteCalendarEvent(tenantId, eventId);
  }
}