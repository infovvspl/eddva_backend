import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EngagementState, LeaderboardScope } from '../../../database/entities/analytics.entity';

export class PerformanceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class LeaderboardQueryDto {
  @ApiProperty({ enum: LeaderboardScope })
  @IsEnum(LeaderboardScope)
  scope: LeaderboardScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  scopeValue?: string;

  @ApiPropertyOptional({ example: '2026-03' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}

export class LogEngagementDto {
  @ApiProperty()
  @IsUUID()
  lectureId: string;

  @ApiProperty({ enum: EngagementState })
  @IsEnum(EngagementState)
  state: EngagementState;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds: number;
}
