import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class MockTestListQueryDto {
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}

export class CreateMockTestDto {
  @IsUUID()
  batchId: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsString()
  title: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalMarks: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  passingMarks?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  questionIds: string[];

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  shuffleQuestions?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  showAnswersAfterSubmit?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  allowReattempt?: boolean;
}

export class UpdateMockTestDto {
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalMarks?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  passingMarks?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  questionIds?: string[];

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  shuffleQuestions?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  showAnswersAfterSubmit?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  allowReattempt?: boolean;
}
