import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { TicketPriority } from './create-coaching-support-ticket.dto';
import { TicketStatus } from './update-coaching-support-ticket.dto';

export enum TicketScope {
  RECEIVED = 'received',
  OUTGOING = 'outgoing',
  ESCALATED = 'escalated',
  ALL = 'all',
}

export class QueryCoachingSupportTicketDto {
  @ApiPropertyOptional({ enum: TicketScope })
  @IsEnum(TicketScope)
  @IsOptional()
  scope?: TicketScope;

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  instituteId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  creatorRole?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC';
}
