import {
  IsString, IsInt, IsOptional, IsArray, IsBoolean,
  IsIn, Min, Max, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const VALID_EXAMS = ['jee_mains', 'jee_advanced', 'neet'] as const;
export type ExamType = typeof VALID_EXAMS[number];

export const EXAM_LABELS: Record<string, string> = {
  jee_mains:    'JEE Mains',
  jee_advanced: 'JEE Advanced',
  neet:         'NEET',
};

// ── Admin DTOs ────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

export class GenerateAIPYQDto {
  @ApiProperty() @IsUUID() topicId: string;
  @ApiProperty() @IsInt() @Min(2000) @Max(CURRENT_YEAR) @Type(() => Number) startYear: number;
  @ApiProperty() @IsInt() @Min(2000) @Max(CURRENT_YEAR) @Type(() => Number) endYear: number;
  @ApiProperty({ type: [String] })
  @IsArray() @IsIn(VALID_EXAMS, { each: true }) exams: ExamType[];
}

export class GenerateChapterPYQDto {
  @ApiProperty() @IsUUID() chapterId: string;
  @ApiProperty() @IsInt() @Min(2000) @Max(CURRENT_YEAR) @Type(() => Number) startYear: number;
  @ApiProperty() @IsInt() @Min(2000) @Max(CURRENT_YEAR) @Type(() => Number) endYear: number;
  @ApiProperty({ type: [String] })
  @IsArray() @IsIn(VALID_EXAMS, { each: true }) exams: ExamType[];
}

export class VerifyPYQDto {
  @ApiProperty() @IsBoolean() isVerified: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() correctedContent?: string;
  @ApiPropertyOptional() @IsOptional() correctedOptions?: { id: string; text: string }[];
  @ApiPropertyOptional() @IsOptional() @IsArray() correctedCorrectOptionIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() correctedExplanation?: string;
}

export class UnverifiedQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() topicId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(VALID_EXAMS) exam?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) limit?: number = 20;
}

// ── Student DTOs ──────────────────────────────────────────────────────────────

export class PYQFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) year?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(VALID_EXAMS) exam?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['attempted', 'unattempted']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) limit?: number = 10;
}

export class StartPYQSessionDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Type(() => Number) year?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(2000) @Type(() => Number) startYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Max(new Date().getFullYear()) @Type(() => Number) endYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(VALID_EXAMS) exam?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) @Type(() => Number) limit?: number = 200;
}

export class SubmitPYQAnswerDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() selectedOptionIds?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() integerResponse?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Type(() => Number) timeTakenSeconds?: number;
}
