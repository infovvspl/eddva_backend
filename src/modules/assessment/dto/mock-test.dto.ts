import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MockTestScope, MockTestType } from '../../../database/entities/assessment.entity';

export class MockTestListQueryDto {
  @IsOptional()
  @IsEnum(MockTestScope)
  scope?: MockTestScope;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsEnum(MockTestType)
  type?: MockTestType;

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
  @IsString()
  title: string;

  @IsEnum(MockTestType)
  type: MockTestType;

  @IsOptional()
  @IsEnum(MockTestScope)
  scope?: MockTestScope;

  // Scope targets — at least one should be provided based on scope
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

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
  @IsEnum(MockTestScope)
  scope?: MockTestScope;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsUUID()
  topicId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(MockTestType)
  type?: MockTestType;

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
