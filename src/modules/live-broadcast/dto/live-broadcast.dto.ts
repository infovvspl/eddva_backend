import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
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
}

/** Payload nginx-rtmp sends on on_publish / on_publish_done — `name` is the stream key. */
export class RtmpEventDto {
  @ApiProperty()
  @IsString()
  name: string;
}
