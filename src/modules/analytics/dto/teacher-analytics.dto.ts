import { IsOptional, IsString, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TeacherAnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;
}

export class ClassPerformanceQueryDto extends TeacherAnalyticsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ enum: ['name', 'score', 'accuracy', 'doubts', 'watchPct'] })
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  order?: 'asc' | 'desc';
}

export class ExportQueryDto extends TeacherAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ['class-performance', 'doubt-analytics', 'topic-coverage'] })
  @IsOptional()
  @IsString()
  type?: string;
}