import {
  IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsBoolean, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StudyMaterialExam, StudyMaterialType } from '../study-material.entity';

// ── Admin: Create ──────────────────────────────────────────────────────────────

export class CreateStudyMaterialDto {
  @ApiProperty({ enum: StudyMaterialExam })
  @IsEnum(StudyMaterialExam)
  exam: StudyMaterialExam;

  @ApiProperty({ enum: StudyMaterialType })
  @IsEnum(StudyMaterialType)
  type: StudyMaterialType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chapter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /** The S3 key returned after the frontend PUT to the pre-signed URL */
  @ApiProperty({ description: 'S3 object key from upload-url response' })
  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  fileSizeKb?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  totalPages?: number;

  @ApiPropertyOptional({ default: 2, description: 'Pages visible without enrollment (default 2)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  previewPages?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

// ── Admin: Update ─────────────────────────────────────────────────────────────

export class UpdateStudyMaterialDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() chapter?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) totalPages?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) previewPages?: number;
}

// ── Public: List query ────────────────────────────────────────────────────────

export class ListStudyMaterialDto {
  @ApiPropertyOptional({ enum: StudyMaterialExam })
  @IsOptional()
  @IsEnum(StudyMaterialExam)
  exam?: StudyMaterialExam;

  @ApiPropertyOptional({ enum: StudyMaterialType })
  @IsOptional()
  @IsEnum(StudyMaterialType)
  type?: StudyMaterialType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
