import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';
import { XpLeaderboardService } from './xp-leaderboard.service';

@ApiTags('XP Leaderboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
@Controller('leaderboard')
export class XpLeaderboardController {
  constructor(private readonly xpLeaderboardService: XpLeaderboardService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current student XP leaderboard stats' })
  getMe(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.xpLeaderboardService.getMe(user, tenantId);
  }

  @Get('group')
  @ApiOperation({ summary: 'Get current student leaderboard group' })
  getGroup(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.xpLeaderboardService.getGroup(user, tenantId);
  }

  @Get('mock/:examType')
  @ApiOperation({ summary: 'Get current student mock-test rank' })
  @ApiParam({ name: 'examType', enum: ['jee', 'neet'] })
  getMockRank(
    @Param('examType') examType: 'jee' | 'neet',
    @CurrentUser() user: any,
    @TenantId() tenantId: string,
  ) {
    const normalized = examType === 'neet' ? 'neet' : 'jee';
    return this.xpLeaderboardService.getMockRank(user, tenantId, normalized);
  }
}
