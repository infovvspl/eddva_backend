import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { PresenceService } from './presence.service';

@ApiTags('Presence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update online presence (call every 30 s)' })
  async heartbeat(
    @CurrentUser() user: { id: string; role: string },
    @TenantId() tenantId: string,
  ): Promise<{ ok: true }> {
    await this.presenceService.beat(user.id, user.role, tenantId);
    return { ok: true };
  }

  @Get('stats')
  @Roles(UserRole.INSTITUTE_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Live stats for admin (students, teachers, live classes)' })
  adminStats(@TenantId() tenantId: string) {
    return this.presenceService.getAdminStats(tenantId);
  }

  @Get('stats/teacher')
  @Roles(UserRole.TEACHER, UserRole.INSTITUTE_ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Live stats for teacher (students online)' })
  teacherStats(@TenantId() tenantId: string) {
    return this.presenceService.getTeacherStats(tenantId);
  }
}
