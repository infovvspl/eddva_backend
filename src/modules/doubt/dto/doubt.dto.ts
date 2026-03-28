import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DoubtSource, DoubtStatus, ExplanationMode } from '../../../database/entities/learning.entity';

export class CreateDoubtDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  questionText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  questionImageUrl?: string;

  @ApiProperty({ enum: DoubtSource })
  @IsEnum(DoubtSource)
  source: DoubtSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceRefId?: string;

  @ApiProperty({ enum: ExplanationMode })
  @IsEnum(ExplanationMode)
  explanationMode: ExplanationMode;
}

export class DoubtListQueryDto {
  @ApiPropertyOptional({ enum: DoubtStatus })
  @IsOptional()
  @IsEnum(DoubtStatus)
  status?: DoubtStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  topicId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

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

export class MarkDoubtHelpfulDto {
  @ApiProperty()
  @IsBoolean()
  isHelpful: boolean;
}

export class TeacherResponseDto {
  @ApiProperty()
  @IsString()
  teacherResponse: string;

  @ApiPropertyOptional({ description: 'Teacher rating of AI answer quality: correct | partial | wrong' })
  @IsOptional()
  @IsString()
  aiQualityRating?: string;

  @ApiPropertyOptional({ description: 'Lecture reference e.g. "Lecture 3 at 12:30"' })
  @IsOptional()
  @IsString()
  lectureRef?: string;

  @ApiPropertyOptional({ description: 'URL of diagram or image to supplement the response' })
  @IsOptional()
  @IsString()
  responseImageUrl?: string;
}

export class RateTeacherResponseDto {
  @ApiProperty({ description: 'Whether the student found the teacher response helpful' })
  @IsBoolean()
  isHelpful: boolean;
}

export class MarkDoubtReviewedDto {
  @ApiPropertyOptional({ description: 'AI quality rating when marking as reviewed' })
  @IsOptional()
  @IsString()
  aiQualityRating?: string;
}
