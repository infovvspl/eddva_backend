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
    IsInt,
    Min,
    Max,
    ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    QuestionType,
    DifficultyLevel,
    QuestionSource,
} from '../../../database/entities/question.entity';

export class CreateOptionDto {
    @ApiProperty({ example: 'A' })
    @IsString()
    @IsNotEmpty()
    optionLabel: string;

    @ApiProperty({ example: 'The net work done by the gas is zero' })
    @IsString()
    @IsNotEmpty()
    content: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    contentImageUrl?: string;

    @ApiProperty({ example: false })
    @IsBoolean()
    isCorrect: boolean;

    @ApiPropertyOptional({ example: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    sortOrder?: number;
}

export class CreateQuestionDto {
    @ApiProperty({ example: 'uuid-of-topic' })
    @IsUUID()
    @IsNotEmpty()
    topicId: string;

    @ApiProperty({ example: 'A Carnot engine operates between 500 K and 300 K. What is its efficiency?' })
    @IsString()
    @IsNotEmpty()
    content: string;

    @ApiProperty({ enum: QuestionType })
    @IsEnum(QuestionType)
    type: QuestionType;

    @ApiProperty({ enum: DifficultyLevel })
    @IsEnum(DifficultyLevel)
    difficulty: DifficultyLevel;

    @ApiPropertyOptional({ enum: QuestionSource })
    @IsOptional()
    @IsEnum(QuestionSource)
    source?: QuestionSource;

    @ApiPropertyOptional({ example: 4 })
    @IsOptional()
    @IsNumber()
    marksCorrect?: number;

    @ApiPropertyOptional({ example: -1 })
    @IsOptional()
    @IsNumber()
    marksWrong?: number;

    @ApiPropertyOptional({ description: 'Required when type=integer' })
    @IsOptional()
    @IsString()
    integerAnswer?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    contentImageUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    solutionText?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    solutionVideoUrl?: string;

    @ApiPropertyOptional({ example: 2023 })
    @IsOptional()
    @IsInt()
    @Min(1990)
    @Max(2099)
    pyqYear?: number;

    @ApiPropertyOptional({ example: 'JEE Mains Jan' })
    @IsOptional()
    @IsString()
    pyqPaper?: string;

    @ApiPropertyOptional({ type: [String], example: ['thermodynamics', 'carnot'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ type: [CreateOptionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOptionDto)
    options?: CreateOptionDto[];
}

export class UpdateQuestionDto extends PartialType(CreateQuestionDto) { }

export class QuestionQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsUUID()
    topicId?: string;

    @ApiPropertyOptional({ enum: DifficultyLevel })
    @IsOptional()
    @IsEnum(DifficultyLevel)
    difficulty?: DifficultyLevel;

    @ApiPropertyOptional({ enum: QuestionType })
    @IsOptional()
    @IsEnum(QuestionType)
    type?: QuestionType;

    @ApiPropertyOptional({ enum: QuestionSource })
    @IsOptional()
    @IsEnum(QuestionSource)
    source?: QuestionSource;

    @ApiPropertyOptional({ example: 'carnot' })
    @IsOptional()
    @IsString()
    search?: string;

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

export class BulkCreateQuestionDto {
    @ApiProperty({ type: [CreateQuestionDto] })
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => CreateQuestionDto)
    questions: CreateQuestionDto[];
}
