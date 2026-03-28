import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { BattleService } from './battle.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, TenantId } from '../../common/decorators/auth.decorator';
import { BattleMode } from '../../database/entities/battle.entity';

class CreateBattleDto {
  @IsOptional() @IsString() topicId?: string;
  @IsOptional() @IsEnum(BattleMode) mode?: BattleMode;
}

class JoinBattleDto {
  @IsString() roomCode: string;
}

@ApiTags('Battle')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('battles')
export class BattleController {
  constructor(private readonly battleService: BattleService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a battle room' })
  createBattle(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body() dto: CreateBattleDto,
  ) {
    return this.battleService.createBattleRoom(userId, tenantId, dto.mode, dto.topicId);
  }

  @Post('join')
  @ApiOperation({ summary: 'Join a battle by room code' })
  joinBattle(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
    @Body() dto: JoinBattleDto,
  ) {
    return this.battleService.joinBattleByCode(dto.roomCode, userId, tenantId);
  }

  @Get('daily')
  @ApiOperation({ summary: "Get today's daily battle" })
  getDailyBattle(@TenantId() tenantId: string) {
    return this.battleService.getDailyBattle(tenantId);
  }

  @Get('my-history')
  @ApiOperation({ summary: 'Get my battle history' })
  getMyHistory(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.battleService.getMyHistory(userId, tenantId);
  }

  @Get('my-elo')
  @ApiOperation({ summary: 'Get my ELO / battle stats' })
  getMyElo(
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.battleService.getMyElo(userId, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get battle room by id' })
  getRoom(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.battleService.getRoom(id, tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel / abandon a battle' })
  cancelBattle(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.battleService.cancelBattle(id, userId, tenantId);
  }
}
