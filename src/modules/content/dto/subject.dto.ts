import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsBoolean,
    Min,
    MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const normalizeSubjectField = ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.trim().replace(/\s+/g, ' ');
};

export class CreateSubjectDto {
    @ApiProperty({ example: 'Physics' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ example: 'jee', description: 'Preset or custom exam target label for the subject' })
    @Transform(normalizeSubjectField)
    @IsString()
    @MinLength(1)
    examTarget: string;

    @ApiPropertyOptional({ description: 'Batch/Course this subject belongs to' })
    @IsOptional()
    @IsString()
    batchId?: string;

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
    @ApiPropertyOptional({ example: 'neet' })
    @IsOptional()
    @Transform(normalizeSubjectField)
    @IsString()
    @MinLength(1)
    examTarget?: string;

    @ApiPropertyOptional({ description: 'Filter subjects assigned to this batch' })
    @IsOptional()
    @IsString()
    batchId?: string;
}
