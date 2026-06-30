import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLectureDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'ISO timestamp the lecture is scheduled for' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ type: [String], example: ['360p', '480p', '720p', '1080p'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  qualities?: string[];

  @ApiPropertyOptional({ description: 'Coaching batch ID this lecture belongs to' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Subject ID for the lecture' })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  batchName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subjectName?: string;
}

export class CreatePollDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question: string;

  @ApiProperty({ type: [String], minItems: 2, maxItems: 6 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  options: string[];

  @ApiPropertyOptional({ description: 'The correct option text (optional, for quizzes)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  correctOption?: string;
}

export class VotePollDto {
  @ApiProperty({ description: 'The option text the student is voting for' })
  @IsString()
  @MaxLength(200)
  option: string;
}

/** Payload nginx-rtmp sends on on_publish / on_publish_done — `name` is the stream key. */
export class RtmpEventDto {
  @ApiProperty()
  @IsString()
  name: string;
}
