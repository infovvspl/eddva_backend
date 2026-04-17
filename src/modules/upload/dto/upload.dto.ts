import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export enum UploadType {
  PROFILE = 'profile',
  THUMBNAIL = 'thumbnail',
  MATERIAL = 'material',
  SOURCE = 'source',
  LECTURE_VIDEO = 'lecture-video',
  LECTURE_THUMBNAIL = 'lecture-thumbnail',
  LECTURE_ATTACHMENT = 'lecture-attachment',
}

export class GenerateUploadUrlDto {
  @ApiProperty({ enum: UploadType })
  @IsEnum(UploadType, { message: 'Invalid upload type' })
  @IsNotEmpty()
  type: UploadType;

  @ApiPropertyOptional({ description: 'Required for course uploads and all lecture uploads' })
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ description: 'Required for lecture uploads' })
  @IsOptional()
  @IsUUID()
  lectureId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contentType: string;

  @ApiProperty({ description: 'File size in bytes' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  fileSize: number;
}
