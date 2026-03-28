import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsNumber,
    IsBoolean,
    IsUUID,
    Min,
    Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateChapterDto {
    @ApiProperty({ example: 'uuid-of-subject' })
    @IsUUID()
    @IsNotEmpty()
    subjectId: string;

    @ApiProperty({ example: 'Thermodynamics' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional({ example: 8.5 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    jeeWeightage?: number;

    @ApiPropertyOptional({ example: 12.0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    neetWeightage?: number;
}

export class UpdateChapterDto extends PartialType(CreateChapterDto) {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class ChapterQueryDto {
    @ApiProperty({ example: 'uuid-of-subject' })
    @IsUUID()
    @IsNotEmpty()
    subjectId: string;
}
