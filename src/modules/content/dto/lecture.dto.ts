import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsOptional,
    IsNumber,
    IsBoolean,
    IsUUID,
    IsArray,
    ValidateNested,
    IsDateString,
    IsInt,
    Min,
    Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    LectureType,
    LectureStatus,
} from '../../../database/entities/learning.entity';

export class QuizOptionDto {
    @ApiProperty({ example: 'A' })
    @IsString()
    label: string;

    @ApiProperty({ example: 'An object remains at rest unless acted upon by an external force' })
    @IsString()
    text: string;
}

export class QuizCheckpointDto {
    @ApiProperty({ example: 'q1' })
    @IsString()
    id: string;

    @ApiProperty({ example: "What is Newton's first law?" })
    @IsString()
    questionText: string;

    @ApiProperty({ type: [QuizOptionDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QuizOptionDto)
    options: QuizOptionDto[];

    @ApiProperty({ example: 'A' })
    @IsString()
    correctOption: string;

    @ApiProperty({ example: 25, description: '% through the video when this appears (0-100)' })
    @IsInt()
    @Min(0)
    @Max(100)
    triggerAtPercent: number;

    @ApiProperty({ example: 'Introduction to Mechanics' })
    @IsString()
    segmentTitle: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    explanation?: string;
}

export class SaveQuizCheckpointsDto {
    @ApiProperty({ type: [QuizCheckpointDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QuizCheckpointDto)
    questions: QuizCheckpointDto[];
}

export class SubmitQuizResponseDto {
    @ApiProperty({ example: 'q1' })
    @IsString()
    questionId: string;

    @ApiProperty({ example: 'A' })
    @IsString()
    selectedOption: string;

    @ApiPropertyOptional({ example: 18, description: 'Seconds taken to answer' })
    @IsOptional()
    @IsInt()
    timeTakenSeconds?: number;
}

export class CreateLectureDto {
    @ApiProperty({ example: 'uuid-of-batch' })
    @IsUUID()
    @IsNotEmpty()
    batchId: string;

    @ApiPropertyOptional({ example: 'uuid-of-topic' })
    @IsOptional()
    @IsUUID()
    topicId?: string;

    @ApiProperty({ example: 'Laws of Thermodynamics - Part 1' })
    @IsString()
    @IsNotEmpty()
    title: string;

    @ApiPropertyOptional({ example: 'Covers zeroth and first laws with examples' })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ enum: LectureType })
    @IsEnum(LectureType)
    type: LectureType;

    @ApiPropertyOptional({ description: 'Required if type=recorded' })
    @IsOptional()
    @IsString()
    videoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    thumbnailUrl?: string;

    @ApiPropertyOptional({ description: 'Required if type=live', example: '2026-03-15T10:00:00Z' })
    @IsOptional()
    @IsDateString()
    scheduledAt?: string;

    @ApiPropertyOptional({ description: 'Required if type=live' })
    @IsOptional()
    @IsString()
    liveMeetingUrl?: string;
}

export class UpdateLectureDto extends PartialType(CreateLectureDto) {
    @ApiPropertyOptional({ enum: LectureStatus, description: 'Teachers may set published or draft' })
    @IsOptional()
    @IsEnum(LectureStatus)
    status?: LectureStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    aiNotesMarkdown?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    aiKeyConcepts?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    aiFormulas?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    transcript?: string;

    @ApiPropertyOptional({ type: [QuizCheckpointDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QuizCheckpointDto)
    quizCheckpoints?: QuizCheckpointDto[];
}

export class LectureQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    batchId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    topicId?: string;

    @ApiPropertyOptional({ enum: LectureStatus })
    @IsOptional()
    @IsEnum(LectureStatus)
    status?: LectureStatus;

    @ApiPropertyOptional({ example: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({ example: 20, default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class UpsertProgressDto {
    @ApiProperty({ example: 65.5, description: 'Percentage watched (0-100)' })
    @IsNumber()
    @Min(0)
    @Max(100)
    watchPercentage: number;

    @ApiProperty({ example: 1230, description: 'Last playback position in seconds' })
    @IsInt()
    @Min(0)
    lastPositionSeconds: number;

    @ApiPropertyOptional({ example: 3 })
    @IsOptional()
    @IsInt()
    @Min(0)
    rewindCount?: number;

    @ApiPropertyOptional({ type: [Object] })
    @IsOptional()
    @IsArray()
    confusionFlags?: Array<{ timestampSeconds: number; rewindCount: number }>;
}

export class ProgressQueryDto {
    @ApiPropertyOptional({ description: 'Admin/teacher: specify studentId to view their progress' })
    @IsOptional()
    @IsUUID()
    studentId?: string;
}
