import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

import { CalendarFeedService } from './calendar-feed.service';
import { InstituteSettingsService } from './institute-settings.service';
import { CreateCalendarEventDto } from './dto/institute-settings.dto';

@ApiTags('Calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('calendar')
export class AcademicCalendarController {
  constructor(
    private readonly feed: CalendarFeedService,
    private readonly settings: InstituteSettingsService,
  ) {}

  @Get('feed')
  @Roles(UserRole.STUDENT, UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({
    summary: 'Academic calendar feed — institute events + scheduled live classes for the viewer',
  })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'month', required: false })
  getFeed(
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.feed.getAggregatedFeed(
      user,
      tenantId,
      year ? +year : undefined,
      month ? +month : undefined,
    );
  }

  @Post('events')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Add an institute calendar event (notifies enrolled students)' })
  createEvent(
    @TenantId() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.settings.createCalendarEvent(tenantId, dto, userId);
  }

  @Delete('events/:eventId')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @ApiOperation({ summary: 'Remove a calendar event' })
  deleteEvent(@TenantId() tenantId: string, @Param('eventId') eventId: string) {
    return this.settings.deleteCalendarEvent(tenantId, eventId);
  }
}
