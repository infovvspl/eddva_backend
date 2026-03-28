import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsOptional,
    IsNumber,
    IsBoolean,
    Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ExamTarget } from '../../../database/entities/student.entity';

export class CreateSubjectDto {
    @ApiProperty({ example: 'Physics' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ enum: ExamTarget })
    @IsEnum(ExamTarget)
    examTarget: ExamTarget;

    @ApiPropertyOptional({ example: 'atom-icon' })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiPropertyOptional({ example: '#FF6B35' })
    @IsOptional()
    @IsString()
    colorCode?: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    sortOrder?: number;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class SubjectQueryDto {
    @ApiPropertyOptional({ enum: ExamTarget })
    @IsOptional()
    @IsEnum(ExamTarget)
    examTarget?: ExamTarget;

    @ApiPropertyOptional({ description: 'Filter subjects assigned to this batch' })
    @IsOptional()
    @IsString()
    batchId?: string;
}
